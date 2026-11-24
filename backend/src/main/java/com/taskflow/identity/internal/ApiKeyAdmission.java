package com.taskflow.identity.internal;

import com.taskflow.shared.RateLimiter;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Clock;
import java.time.Duration;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * The per-key per-minute budget (KEY-5, AD-7): a Redis fixed window shared by REST and MCP calls of
 * the key. Headers and Retry-After come from the same epoch minute, so they always agree.
 */
@Component
class ApiKeyAdmission {

  private static final Logger log = LoggerFactory.getLogger(ApiKeyAdmission.class);
  static final Duration WINDOW = Duration.ofSeconds(61);
  private static final long FAILURE_WARN_AT = 50;

  /** {@code resetEpochSecond} is the start of the next minute. */
  record Window(
      boolean allowed, int limit, long remaining, long resetEpochSecond, long retryAfter) {}

  private final RateLimiter limiter;
  private final ApiKeyProperties properties;
  private final MeterRegistry meters;
  private final Clock clock = Clock.systemUTC();

  ApiKeyAdmission(RateLimiter limiter, ApiKeyProperties properties, MeterRegistry meters) {
    this.limiter = limiter;
    this.properties = properties;
    this.meters = meters;
  }

  /** Counts one call of the key. A Redis error is thrown: the caller fails closed. */
  Window hit(UUID keyId) {
    long now = clock.instant().getEpochSecond();
    long minute = now / 60;
    long reset = (minute + 1) * 60;
    int limit = properties.perMinute();
    RateLimiter.Decision d = limiter.hit("apikey:" + keyId + ":" + minute, limit, WINDOW);
    return new Window(
        d.allowed(), limit, Math.max(0, limit - d.count()), reset, Math.max(1, reset - now));
  }

  /**
   * Counts a failed key per client IP, for a WARN log and a metric only: behind the proxy every
   * caller shares one IP, so it must never block anything. Redis errors are swallowed.
   */
  void noteFailure(String ip) {
    meters.counter("taskflow.api_key.failures").increment();
    try {
      long minute = clock.instant().getEpochSecond() / 60;
      RateLimiter.Decision d =
          limiter.hit("apikey-fail:" + ip + ":" + minute, Integer.MAX_VALUE, WINDOW);
      if (d.count() == FAILURE_WARN_AT) {
        log.warn("{} failed API key attempts from {} in one minute", d.count(), ip);
      }
    } catch (RuntimeException e) {
      log.debug("api key failure count skipped: {}", e.toString());
    }
  }
}
