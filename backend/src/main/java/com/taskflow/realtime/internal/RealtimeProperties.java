package com.taskflow.realtime.internal;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** {@code taskflow.realtime.*}: presence timing and the expired-token sweep (AD-13, AD-16). */
@ConfigurationProperties("taskflow.realtime")
record RealtimeProperties(
    @DefaultValue("60000") long presenceTtlMs,
    @DefaultValue("10000") long presenceSweepMs,
    @DefaultValue("5000") long sessionSweepMs) {}
