package com.taskflow.identity.internal;

import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** Per-key limits by plan (KEY-5). Every Workspace is on the {@code default} plan. */
@ConfigurationProperties("taskflow.api-keys")
record ApiKeyProperties(@DefaultValue RateLimit rateLimit) {

  static final String DEFAULT_PLAN = "default";
  static final int FALLBACK_LIMIT = 100;

  record RateLimit(Map<String, Integer> plans) {

    int perMinute(String plan) {
      Integer limit = plans == null ? null : plans.get(plan);
      return limit == null ? FALLBACK_LIMIT : limit;
    }
  }

  int perMinute() {
    return rateLimit == null ? FALLBACK_LIMIT : rateLimit.perMinute(DEFAULT_PLAN);
  }
}
