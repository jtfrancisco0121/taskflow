package com.taskflow.identity.internal;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Sign-in attempts allowed per client IP per minute. The default, 20, is the production limit
 * ({@link AuthService#IP_ATTEMPT_LIMIT}) and is not set in application.yml or by any environment
 * variable. Only application-dev.yml raises it, because local e2e runs sign in many times from
 * 127.0.0.1 (epic 14yq6g334tf; SignInLimitsTest keeps it that way).
 */
@ConfigurationProperties("taskflow.auth.sign-in")
record SignInLimits(@DefaultValue("20") int ipAttemptLimit) {

  SignInLimits {
    if (ipAttemptLimit < 1) {
      throw new IllegalStateException("taskflow.auth.sign-in.ip-attempt-limit must be at least 1");
    }
  }
}
