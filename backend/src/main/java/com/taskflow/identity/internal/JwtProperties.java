package com.taskflow.identity.internal;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Token settings (AD-5). The secret has no default outside the dev profile (AD-23). {@code
 * refreshReuseGrace} is how long the token just rotated may be replayed for the same successor
 * (decision 010); zero turns it off, and more than five minutes is refused at startup.
 */
@ConfigurationProperties("taskflow.jwt")
record JwtProperties(
    String secret,
    @DefaultValue("PT15M") Duration accessTtl,
    @DefaultValue("P30D") Duration refreshTtl,
    @DefaultValue("PT30S") Duration refreshReuseGrace) {

  /**
   * A replay window longer than this is no longer a lost response; it widens theft (decision 010).
   */
  static final Duration MAX_REFRESH_REUSE_GRACE = Duration.ofMinutes(5);

  JwtProperties {
    if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32) {
      throw new IllegalStateException(
          "TASKFLOW_JWT_SECRET must be set to at least 32 bytes (use the dev profile for local work)");
    }
    if (refreshReuseGrace == null || refreshReuseGrace.isNegative()) {
      throw new IllegalStateException("taskflow.jwt.refresh-reuse-grace must be zero or positive");
    }
    if (refreshReuseGrace.compareTo(MAX_REFRESH_REUSE_GRACE) > 0) {
      throw new IllegalStateException(
          "taskflow.jwt.refresh-reuse-grace must be at most " + MAX_REFRESH_REUSE_GRACE);
    }
  }
}
