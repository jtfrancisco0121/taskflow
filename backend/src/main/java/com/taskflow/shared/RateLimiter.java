package com.taskflow.shared;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

/** Redis fixed-window counters, shared by every instance (AD-6). */
@Component
public class RateLimiter {

  /** The outcome of a check. {@code retryAfterSeconds} is only meaningful when not allowed. */
  public record Decision(boolean allowed, long count, long retryAfterSeconds) {}

  /**
   * INCR and the expiry in one step, so a counter can never be left without a TTL: a key that
   * exists without one (an earlier failure between two commands) gets its expiry on the next hit.
   */
  private static final RedisScript<Long> HIT =
      new DefaultRedisScript<>(
          "local c = redis.call('INCR', KEYS[1])\n"
              + "if redis.call('PTTL', KEYS[1]) == -1 then redis.call('PEXPIRE', KEYS[1], ARGV[1])"
              + " end\n"
              + "return c",
          Long.class);

  private final StringRedisTemplate redis;

  RateLimiter(StringRedisTemplate redis) {
    this.redis = redis;
  }

  /** Counts one hit in the window and says whether it is within the limit. */
  public Decision hit(String key, int limit, Duration window) {
    String k = "rl:" + key;
    Long count = redis.execute(HIT, List.of(k), String.valueOf(window.toMillis()));
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
