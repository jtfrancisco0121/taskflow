package com.taskflow.shared.internal;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Enables scheduling unconditionally (AD-11). The purge scheduler that used to hold the annotation
 * can be switched off, which would silently stop the outbox relay and the presence sweep. The pool
 * size is {@code spring.task.scheduling.pool.size}.
 */
@Configuration
@EnableScheduling
class SchedulingConfig {}
