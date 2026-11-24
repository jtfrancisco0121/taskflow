package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.TestPropertySource;

/** The sign-in IP limit behind a trusted reverse proxy (decision 005.14). */
@TestPropertySource(properties = "taskflow.http.trusted-proxies=127.0.0.1,::1")
class SignInRateLimitBehindProxyIT extends IntegrationTest {

  @Autowired StringRedisTemplate redis;

  @Test
  void twoClientsBehindTheSameProxyHaveSeparateBuckets() {
    String a = clientIp();
    String b = clientIp();
    exhaust(a);

    Resp blocked = signIn("X-Forwarded-For", a);
    assertThat(blocked.status()).isEqualTo(429);
    assertThat(blocked.text("/code")).isEqualTo("auth.rate_limited");
    assertThat(blocked.headers().getFirst("Retry-After")).matches("[1-9][0-9]*");

    assertThat(signIn("X-Forwarded-For", b).status()).isEqualTo(401);
  }

  @Test
  void aValueTheClientPrependsDoesNotDodgeTheLimit() {
    String client = clientIp();
    exhaust(client);

    // The proxy appends the real peer; whatever the client sent stays on the left and is ignored.
    assertThat(signIn("X-Forwarded-For", clientIp() + ", " + client).status()).isEqualTo(429);
  }

  @Test
  void aSpoofedValueCannotPoisonAnotherClientsBucket() {
    String victim = clientIp();
    String attacker = clientIp();
    for (int i = 0; i < AuthService.IP_ATTEMPT_LIMIT + 5; i++) {
      signIn("X-Forwarded-For", victim + ", " + attacker);
    }

    assertThat(redis.hasKey("rl:signin:ip:" + victim)).isFalse();
    assertThat(signIn("X-Forwarded-For", attacker).status()).isEqualTo(429);
    assertThat(signIn("X-Forwarded-For", victim).status()).isEqualTo(401);
  }

  private void exhaust(String ip) {
    for (int i = 0; i < AuthService.IP_ATTEMPT_LIMIT; i++) {
      assertThat(signIn("X-Forwarded-For", ip).status()).isEqualTo(401);
    }
  }

  private Resp signIn(String... headers) {
    return post(
        "/api/v1/auth/signin",
        null,
        Map.of("email", UUID.randomUUID() + "@example.com", "password", "wrong-password"),
        headers);
  }

  /** A fresh address in TEST-NET-3, so no other test shares its bucket. */
  private static String clientIp() {
    int n = Math.floorMod(UUID.randomUUID().hashCode(), 65_536);
    return "203.0." + (n >> 8) + "." + (n & 0xff);
  }
}
