package com.taskflow.shared.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import com.taskflow.shared.RateLimiter;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@DisplayName("AD-6 Redis fixed-window rate limiter")
class RateLimiterIT extends IntegrationTest {

  @Autowired RateLimiter limiter;

  @Test
  void allowsUpToTheLimitThenRefusesWithARetryAfter() {
    String key = "test:" + UUID.randomUUID();
    for (int i = 0; i < 3; i++) {
      assertThat(limiter.hit(key, 3, Duration.ofSeconds(30)).allowed()).isTrue();
    }
    RateLimiter.Decision refused = limiter.hit(key, 3, Duration.ofSeconds(30));
    assertThat(refused.allowed()).isFalse();
    assertThat(refused.retryAfterSeconds()).isBetween(1L, 30L);
  }

  @Test
  void peekDoesNotCountAndResetClears() {
    String key = "test:" + UUID.randomUUID();
    limiter.hit(key, 1, Duration.ofSeconds(30));
    assertThat(limiter.peek(key, 1, Duration.ofSeconds(30)).allowed()).isFalse();
    limiter.reset(key);
    assertThat(limiter.peek(key, 1, Duration.ofSeconds(30)).allowed()).isTrue();
  }

  @Test
  void theWindowExpires() throws InterruptedException {
    String key = "test:" + UUID.randomUUID();
    limiter.hit(key, 1, Duration.ofSeconds(1));
    assertThat(limiter.hit(key, 1, Duration.ofSeconds(1)).allowed()).isFalse();
    Thread.sleep(1500);
    assertThat(limiter.hit(key, 1, Duration.ofSeconds(1)).allowed()).isTrue();
  }
}
