package com.taskflow.shared;

import java.time.Duration;
import java.util.concurrent.TimeUnit;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/** Redis fixed-window counters, shared by every instance (AD-6). */
@Component
public class RateLimiter {

  /** The outcome of a check. {@code retryAfterSeconds} is only meaningful when not allowed. */
  public record Decision(boolean allowed, long count, long retryAfterSeconds) {}

  private final StringRedisTemplate redis;

  RateLimiter(StringRedisTemplate redis) {
    this.redis = redis;
  }

  /** Counts one hit in the window and says whether it is within the limit. */
  public Decision hit(String key, int limit, Duration window) {
    String k = "rl:" + key;
    Long count = redis.opsForValue().increment(k);
    if (count != null && count == 1L) {
      redis.expire(k, window);
    }
    long c = count == null ? 0 : count;
    return new Decision(c <= limit, c, c <= limit ? 0 : ttl(k, window));
  }

  /** Reads the window counter without counting. */
  public Decision peek(String key, int limit, Duration window) {
    String k = "rl:" + key;
    String raw = redis.opsForValue().get(k);
    long c = raw == null ? 0 : Long.parseLong(raw);
    return new Decision(c < limit, c, c < limit ? 0 : ttl(k, window));
  }

  public void reset(String key) {
    redis.delete("rl:" + key);
  }

  private long ttl(String k, Duration window) {
    Long seconds = redis.getExpire(k, TimeUnit.SECONDS);
    if (seconds == null || seconds < 0) {
      return window.toSeconds();
    }
    return Math.max(1, seconds);
  }
}
