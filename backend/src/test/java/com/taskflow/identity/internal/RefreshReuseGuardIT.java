package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Refresh-token reuse detection that any fix for the reload race (ClickUp 14yq6g334jy) must keep: a
 * previous refresh token is honoured, if at all, only while it is the immediate predecessor, its
 * successor has never been used, it was rotated moments ago, and its family is still live.
 */
@DisplayName("AUTH-2 refresh reuse detection guards")
class RefreshReuseGuardIT extends IntegrationTest {

  private static final String REFRESH = "/api/v1/auth/refresh";

  @Autowired private JwtProperties properties;

  private Resp signup() {
    return post(
        "/api/v1/auth/signup",
        null,
        Map.of("email", AuthIT.email(), "password", AuthIT.PASSWORD, "displayName", "Guard"));
  }

  private Resp refresh(String cookie) {
    return post(REFRESH, null, null, "Cookie", cookie);
  }

  private static String hashOf(String cookie) {
    return AuthService.sha256(cookie.substring("refresh_token=".length()));
  }

  private int liveTokens(Resp up) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM refresh_token r JOIN app_user u ON u.id = r.user_id WHERE u.email = ?"
            + " AND r.revoked_at IS NULL",
        Integer.class,
        up.text("/user/email"));
  }

  @Test
  void anOldTokenPresentedAfterItsSuccessorWasUsedRevokesTheFamily() {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    Resp toB = refresh(a);
    assertThat(toB.status()).isEqualTo(200);
    String b = AuthIT.refreshCookie(toB);
    Resp toC = refresh(b);
    assertThat(toC.status()).isEqualTo(200);
    String c = AuthIT.refreshCookie(toC);

    Resp reuse = refresh(a);

    assertThat(reuse.status()).isEqualTo(401);
    assertThat(reuse.text("/code")).isEqualTo("auth.invalid_refresh");
    assertThat(refresh(c).status()).isEqualTo(401);
    assertThat(liveTokens(up)).isZero();
  }

  @Test
  void anOldTokenPresentedLongAfterItsRotationRevokesTheFamilyEvenIfTheSuccessorIsUnused() {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    Resp toB = refresh(a);
    assertThat(toB.status()).isEqualTo(200);
    String b = AuthIT.refreshCookie(toB);
    // Ten minutes is past any grace window under discussion (seconds), yet inside the 15-minute
    // access-token lifetime, so the successor can plausibly still be unused.
    jdbc.update(
        "UPDATE refresh_token SET rotated_at = now() - interval '10 minutes' WHERE token_hash = ?",
        hashOf(a));

    Resp reuse = refresh(a);

    assertThat(reuse.status()).isEqualTo(401);
    assertThat(refresh(b).status()).isEqualTo(401);
    assertThat(liveTokens(up)).isZero();
  }

  @Test
  void aSignedOutFamilyIsNotRevivedByItsPreviousToken() {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    Resp toB = refresh(a);
    assertThat(toB.status()).isEqualTo(200);
    String b = AuthIT.refreshCookie(toB);
    assertThat(post("/api/v1/auth/signout", null, null, "Cookie", b).status()).isEqualTo(204);

    assertThat(refresh(a).status()).isEqualTo(401);
    assertThat(refresh(b).status()).isEqualTo(401);
    assertThat(liveTokens(up)).isZero();
  }

  @Test
  void anExpiredPreviousTokenIsNotHonouredEvenRightAfterItsRotation() {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    Resp toB = refresh(a);
    assertThat(toB.status()).isEqualTo(200);
    jdbc.update(
        "UPDATE refresh_token SET expires_at = now() - interval '1 second' WHERE token_hash = ?",
        hashOf(a));

    assertThat(refresh(a).status()).isEqualTo(401);
  }

  @Test
  void anOldTokenReplayed31SecondsAfterItsRotationRevokesTheFamily() {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    Resp toB = refresh(a);
    assertThat(toB.status()).isEqualTo(200);
    String b = AuthIT.refreshCookie(toB);
    jdbc.update(
        "UPDATE refresh_token SET rotated_at = now() - interval '31 seconds' WHERE token_hash = ?",
        hashOf(a));

    assertThat(refresh(a).status()).isEqualTo(401);
    assertThat(refresh(b).status()).isEqualTo(401);
    assertThat(liveTokens(up)).isZero();
  }

  @Test
  void anOldTokenReplayed29SecondsAfterItsRotationGetsTheSameSuccessor() {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    Resp toB = refresh(a);
    assertThat(toB.status()).isEqualTo(200);
    String b = AuthIT.refreshCookie(toB);
    jdbc.update(
        "UPDATE refresh_token SET rotated_at = now() - interval '29 seconds' WHERE token_hash = ?",
        hashOf(a));

    Resp replay = refresh(a);

    assertThat(replay.status()).isEqualTo(200);
    assertThat(AuthIT.refreshCookie(replay)).isEqualTo(b);
    // A (rotated) and B: nothing revoked and no extra token issued.
    assertThat(liveTokens(up)).isEqualTo(2);
  }

  /**
   * ClickUp 14yq6g334r6 item 6: a token whose user is no longer a human is refused without being
   * marked rotated, so it never becomes a rotated token with no successor.
   */
  @Test
  void aTokenOfAUserWhoIsNoLongerHumanIsRefusedWithoutBeingRotated() {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    jdbc.update(
        "UPDATE app_user SET kind = 'SERVICE_ACCOUNT' WHERE email = ?", up.text("/user/email"));

    assertThat(refresh(a).status()).isEqualTo(401);
    assertThat(
            jdbc.queryForObject(
                "SELECT rotated_at IS NULL FROM refresh_token WHERE token_hash = ?",
                Boolean.class,
                hashOf(a)))
        .isTrue();
    assertThat(liveTokens(up)).isEqualTo(1);
  }

  /**
   * ClickUp 14yq6g334r6 item 7: expiry is set and judged on the database clock, the same clock that
   * judges the grace window, so a JVM/database clock skew cannot split the two decisions.
   * created_at defaults to the transaction's now(), so a database-clock expiry is exactly the TTL
   * after it.
   */
  @Test
  void refreshTokenExpiryIsSetFromTheDatabaseClock() {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    assertThat(refresh(a).status()).isEqualTo(200);

    List<Double> lifetimes =
        jdbc.queryForList(
            "SELECT extract(epoch FROM r.expires_at - r.created_at)::float8 FROM refresh_token r"
                + " JOIN app_user u ON u.id = r.user_id WHERE u.email = ?",
            Double.class,
            up.text("/user/email"));

    assertThat(lifetimes).hasSize(2).containsOnly((double) properties.refreshTtl().toSeconds());
  }

  @Test
  void noRawRefreshTokenIsStored() {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    Resp toB = refresh(a);
    String b = AuthIT.refreshCookie(toB);
    refresh(a);

    for (String cookie : java.util.List.of(a, b)) {
      String raw = cookie.substring("refresh_token=".length());
      assertThat(
              jdbc.queryForObject(
                  "SELECT count(*) FROM refresh_token WHERE token_hash = ? OR token_hash = ?",
                  Integer.class,
                  raw,
                  hashOf(cookie)))
          .isEqualTo(1);
      assertThat(
              jdbc.queryForObject(
                  "SELECT count(*) FROM refresh_token WHERE token_hash = ?", Integer.class, raw))
          .isZero();
    }
  }
}
