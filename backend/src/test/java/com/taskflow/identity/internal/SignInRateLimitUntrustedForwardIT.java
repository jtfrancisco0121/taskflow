package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * With no trusted proxy (the default), X-Forwarded-For is ignored and the TCP peer is the client
 * (decision 006).
 */
class SignInRateLimitUntrustedForwardIT extends IntegrationTest {

  private static final String[] LOOPBACK = {
    "rl:signin:ip:127.0.0.1", "rl:signin:ip:0:0:0:0:0:0:0:1"
  };

  @Autowired StringRedisTemplate redis;

  @BeforeEach
  @AfterEach
  void clearLoopbackBucket() {
    // Other tests in this shared context sign in from loopback too.
    for (String key : LOOPBACK) {
      redis.delete(key);
    }
  }

  @Test
  void aSpoofedForwardedForIsIgnoredAndTheLimitStillApplies() {
    int i = 0;
    for (; i < AuthService.IP_ATTEMPT_LIMIT; i++) {
      Resp r = signIn("X-Forwarded-For", "198.51.100." + i);
      assertThat(r.status()).isEqualTo(401);
    }

    Resp blocked = signIn("X-Forwarded-For", "198.51.100." + (i + 1));
    assertThat(blocked.status()).isEqualTo(429);
    assertThat(blocked.text("/code")).isEqualTo("auth.rate_limited");
    assertThat(blocked.headers().getFirst("Retry-After")).matches("[1-9][0-9]*");
    for (int j = 0; j <= i + 1; j++) {
      assertThat(redis.hasKey("rl:signin:ip:198.51.100." + j)).isFalse();
    }
  }

  private Resp signIn(String... headers) {
    return post(
        "/api/v1/auth/signin",
        null,
        Map.of("email", UUID.randomUUID() + "@example.com", "password", "wrong-password"),
        headers);
  }
}
