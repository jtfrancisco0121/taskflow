package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.taskflow.IntegrationTest;
import com.taskflow.TestcontainersConfiguration;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import javax.crypto.spec.SecretKeySpec;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

/**
 * ClickUp 14yq6g3353g: sign-out ends the family from the refresh cookie alone, whatever access
 * token the tab still sends, and answers 204 only when the family is sure to end.
 */
@DisplayName("AUTH-2 sign-out from an idle tab")
class SignOutIdleTabIT extends IntegrationTest {

  @Autowired private DataSource dataSource;

  private ExecutorService pool;

  @BeforeEach
  void startPool() {
    pool = Executors.newFixedThreadPool(16);
  }

  @AfterEach
  void stopPool() {
    pool.shutdownNow();
  }

  private Resp signup() {
    return post(
        "/api/v1/auth/signup",
        null,
        Map.of("email", AuthIT.email(), "password", AuthIT.PASSWORD, "displayName", "Idle"));
  }

  /** An access token for the user, signed with the real key, that expired 45 minutes ago. */
  private static String expiredAccessToken(Resp up) {
    NimbusJwtEncoder encoder =
        new NimbusJwtEncoder(
            new ImmutableSecret<>(
                new SecretKeySpec(
                    TestcontainersConfiguration.JWT_SECRET.getBytes(StandardCharsets.UTF_8),
                    "HmacSHA256")));
    Instant past = Instant.now().minusSeconds(3600);
    return encoder
        .encode(
            JwtEncoderParameters.from(
                JwsHeader.with(MacAlgorithm.HS256).build(),
                JwtClaimsSet.builder()
                    .subject(up.text("/user/id"))
                    .claim("email", up.text("/user/email"))
                    .issuedAt(past)
                    .expiresAt(past.plusSeconds(900))
                    .build()))
        .getTokenValue();
  }

  private UUID familyOf(String cookie) {
    return jdbc.queryForObject(
        "SELECT family_id FROM refresh_token WHERE token_hash = ?",
        UUID.class,
        AuthService.sha256(cookie.substring("refresh_token=".length())));
  }

  private int liveTokensIn(UUID family) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM refresh_token WHERE family_id = ? AND revoked_at IS NULL",
        Integer.class,
        family);
  }

  private boolean pendingRow(UUID family) {
    return jdbc.queryForObject(
            "SELECT count(*) FROM refresh_pending_revocation WHERE family_id = ?",
            Integer.class,
            family)
        > 0;
  }

  private static void assertClearsCookie(Resp answer) {
    assertThat(answer.headers().get("Set-Cookie"))
        .anySatisfy(c -> assertThat(c).startsWith("refresh_token=;").contains("Max-Age=0"));
  }

  private void assertFamilyEnded(String cookie) {
    assertThat(liveTokensIn(familyOf(cookie))).isZero();
    assertThat(post("/api/v1/auth/refresh", null, null, "Cookie", cookie).status()).isEqualTo(401);
  }

  @Test
  void anExpiredAccessTokenDoesNotStopSignOutFromEndingTheFamily() {
    Resp up = signup();
    String cookie = AuthIT.refreshCookie(up);

    Resp answer = post("/api/v1/auth/signout", expiredAccessToken(up), null, "Cookie", cookie);

    assertThat(answer.status()).isEqualTo(204);
    assertClearsCookie(answer);
    assertFamilyEnded(cookie);
  }

  @Test
  void aMalformedAccessTokenDoesNotStopSignOutFromEndingTheFamily() {
    Resp up = signup();
    String cookie = AuthIT.refreshCookie(up);

    Resp answer = post("/api/v1/auth/signout", "not-a-jwt", null, "Cookie", cookie);

    assertThat(answer.status()).isEqualTo(204);
    assertClearsCookie(answer);
    assertFamilyEnded(cookie);
  }

  @Test
  void anExpiredAccessTokenDoesNotStopARefresh() {
    Resp up = signup();
    String cookie = AuthIT.refreshCookie(up);

    Resp answer = post("/api/v1/auth/refresh", expiredAccessToken(up), null, "Cookie", cookie);

    assertThat(answer.status()).isEqualTo(200);
    assertThat(answer.text("/accessToken")).isNotBlank();
  }

  @Test
  void anExpiredAccessTokenIsStillRefusedEverywhereElse() {
    Resp up = signup();
    String expired = expiredAccessToken(up);

    // The bearer filter's own answer: the token was read and refused, not skipped.
    for (Resp refused :
        List.of(
            get("/api/v1/me", expired),
            post("/api/v1/workspaces", expired, Map.of("name", "x")),
            post("/api/v1/auth/signout/x", expired, null),
            get("/api/v1/auth/signout", expired))) {
      assertThat(refused.status()).isEqualTo(401);
      assertThat(refused.text("/detail")).isEqualTo("Missing, invalid or expired access token");
    }
    assertThat(get("/api/v1/me", up.text("/accessToken")).status()).isEqualTo(200);
  }

  /**
   * A transaction that holds both the family's pending row (an uncommitted insert) and its lock
   * past both 2 s waits, then rolls back: sign-out cannot know the family will end, so it must not
   * answer 204 (PR #36 /code-review, AuthService.java:300).
   */
  @Test
  void aSignOutThatCannotConfirmTheFamilyEndsDoesNotAnswer204() throws Exception {
    Resp up = signup();
    String cookie = AuthIT.refreshCookie(up);
    UUID family = familyOf(cookie);

    Connection holder = dataSource.getConnection();
    holder.setAutoCommit(false);
    Resp answer;
    try {
      lock(holder, family);
      update(holder, "INSERT INTO refresh_pending_revocation (family_id) VALUES (?)", family);
      answer =
          pool.submit(() -> post("/api/v1/auth/signout", null, null, "Cookie", cookie))
              .get(20, TimeUnit.SECONDS);
    } finally {
      holder.rollback();
      holder.close();
    }

    assertThat(liveTokensIn(family)).isPositive();
    assertThat(pendingRow(family)).isFalse();
    assertThat(answer.status()).isEqualTo(503);
    assertThat(answer.text("/code")).isEqualTo("request.busy");
    assertClearsCookie(answer);
  }

  /**
   * The contention the design expects: another request revoking the family holds its row and lock.
   * Its commit ends the family and its rollback puts the committed row back, so 204 is right. The
   * holder here rolls back: the row stands and the next refresh ends the family.
   */
  @Test
  void aSignOutRacingARevocationStillAnswers204() throws Exception {
    Resp up = signup();
    String cookie = AuthIT.refreshCookie(up);
    UUID family = familyOf(cookie);
    jdbc.update("INSERT INTO refresh_pending_revocation (family_id) VALUES (?)", family);

    Connection holder = dataSource.getConnection();
    holder.setAutoCommit(false);
    Resp answer;
    try {
      lock(holder, family);
      update(holder, "DELETE FROM refresh_pending_revocation WHERE family_id = ?", family);
      answer =
          pool.submit(() -> post("/api/v1/auth/signout", null, null, "Cookie", cookie))
              .get(20, TimeUnit.SECONDS);
    } finally {
      holder.rollback();
      holder.close();
    }

    assertThat(answer.status()).isEqualTo(204);
    assertClearsCookie(answer);
    assertThat(pendingRow(family)).isTrue();
    assertThat(post("/api/v1/auth/refresh", null, null, "Cookie", cookie).status()).isEqualTo(401);
    assertThat(liveTokensIn(family)).isZero();
  }

  /**
   * PR #36 /code-review, AuthService.java:406: an expired, never-rotated token takes the pending
   * row and the locked revoke. A burst of sign-outs with it must not queue on 2 s lock waits.
   */
  @Test
  void aBurstOfSignOutsWithAnExpiredTokenDoesNotWaitOnLocks() throws Exception {
    Resp up = signup();
    String cookie = AuthIT.refreshCookie(up);
    UUID family = familyOf(cookie);
    jdbc.update(
        "UPDATE refresh_token SET expires_at = now() - interval '1 second' WHERE family_id = ?",
        family);

    List<Callable<Long>> calls = new ArrayList<>();
    for (int i = 0; i < 16; i++) {
      calls.add(() -> {
        long start = System.nanoTime();
        assertThat(post("/api/v1/auth/signout", null, null, "Cookie", cookie).status())
            .isEqualTo(204);
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
      });
    }
    List<Long> millis = new ArrayList<>();
    for (Future<Long> f : pool.invokeAll(calls, 30, TimeUnit.SECONDS)) {
      millis.add(f.get());
    }

    assertThat(millis).allSatisfy(ms -> assertThat(ms).isLessThan(1_500L));
    assertThat(liveTokensIn(family)).isZero();
    assertThat(pendingRow(family)).isFalse();
  }

  private static void lock(Connection c, UUID family) throws Exception {
    try (PreparedStatement s =
        c.prepareStatement("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))")) {
      s.setString(1, "refresh_family:" + family);
      s.execute();
    }
  }

  private static void update(Connection c, String sql, UUID family) throws Exception {
    try (PreparedStatement s = c.prepareStatement(sql)) {
      s.setObject(1, family);
      s.executeUpdate();
    }
  }
}
