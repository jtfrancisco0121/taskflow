package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.taskflow.IntegrationTest;
import com.taskflow.TestcontainersConfiguration;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

@DisplayName("AUTH-2 tokens and rate limiting")
class TokenIT extends IntegrationTest {

  private Resp signup(String email) {
    return post(
        "/api/v1/auth/signup",
        null,
        Map.of("email", email, "password", AuthIT.PASSWORD, "displayName", "Grace"));
  }

  @Test
  void anExpiredAccessTokenIsRejected() {
    Resp up = signup(AuthIT.email());
    NimbusJwtEncoder encoder =
        new NimbusJwtEncoder(
            new ImmutableSecret<>(
                new SecretKeySpec(
                    TestcontainersConfiguration.JWT_SECRET.getBytes(StandardCharsets.UTF_8),
                    "HmacSHA256")));
    Instant past = Instant.now().minusSeconds(3600);
    String expired =
        encoder
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
    assertThat(get("/api/v1/me", expired).status()).isEqualTo(401);
    assertThat(get("/api/v1/me", up.text("/accessToken")).status()).isEqualTo(200);
  }

  @Test
  void refreshRotatesThePairAndReusingTheOldTokenRevokesTheFamily() {
    Resp up = signup(AuthIT.email());
    String first = AuthIT.refreshCookie(up);

    Resp rotated = post("/api/v1/auth/refresh", null, null, "Cookie", first);
    assertThat(rotated.status()).isEqualTo(200);
    String second = AuthIT.refreshCookie(rotated);
    assertThat(second).isNotEqualTo(first);
    assertThat(rotated.text("/accessToken")).isNotBlank();
    assertThat(get("/api/v1/me", rotated.text("/accessToken")).status()).isEqualTo(200);

    Resp reuse = post("/api/v1/auth/refresh", null, null, "Cookie", first);
    assertThat(reuse.status()).isEqualTo(401);
    assertThat(reuse.text("/code")).isEqualTo("auth.invalid_refresh");

    Resp afterRevoke = post("/api/v1/auth/refresh", null, null, "Cookie", second);
    assertThat(afterRevoke.status()).isEqualTo(401);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM refresh_token r JOIN app_user u ON u.id = r.user_id WHERE u.email = ?"
                    + " AND r.revoked_at IS NULL",
                Integer.class,
                up.text("/user/email")))
        .isZero();
  }

  @Test
  void aMissingOrUnknownRefreshTokenIs401() {
    assertThat(post("/api/v1/auth/refresh", null, null).status()).isEqualTo(401);
    assertThat(post("/api/v1/auth/refresh", null, null, "Cookie", "refresh_token=nope").status())
        .isEqualTo(401);
  }

  @Test
  void theSixthFailedSignInForOneEmailGets429WithRetryAfter() {
    String email = "limited+" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    signup(email);
    for (int i = 0; i < 5; i++) {
      Resp r =
          post(
              "/api/v1/auth/signin",
              null,
              Map.of("email", email, "password", "wrong-password-" + i));
      assertThat(r.status()).isEqualTo(401);
    }
    Resp limited =
        post("/api/v1/auth/signin", null, Map.of("email", email, "password", AuthIT.PASSWORD));
    assertThat(limited.status()).isEqualTo(429);
    assertThat(limited.text("/code")).isEqualTo("auth.rate_limited");
    assertThat(Long.parseLong(limited.headers().getFirst("Retry-After"))).isBetween(1L, 900L);
  }
}
