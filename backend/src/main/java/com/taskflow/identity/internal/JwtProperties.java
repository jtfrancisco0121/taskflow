package com.taskflow.identity.internal;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** Token settings (AD-5). The secret has no default outside the dev profile (AD-23). */
@ConfigurationProperties("taskflow.jwt")
record JwtProperties(
    String secret,
    @DefaultValue("PT15M") Duration accessTtl,
    @DefaultValue("P30D") Duration refreshTtl) {

  JwtProperties {
    if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32) {
      throw new IllegalStateException(
          "TASKFLOW_JWT_SECRET must be set to at least 32 bytes (use the dev profile for local work)");
    }
  }
}
