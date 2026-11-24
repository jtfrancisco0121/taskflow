package com.taskflow.shared.internal;

import org.springframework.boot.task.ThreadPoolTaskSchedulerBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/**
 * Enables scheduling unconditionally (AD-11). The purge scheduler that used to hold the annotation
 * can be switched off, which would silently stop the outbox relay and the presence sweep. The
 * scheduler is named {@code taskScheduler} on purpose: the STOMP gateway adds its own TaskScheduler
 * beans, and without this name Spring would fall back to a single thread. Its pool size is {@code
 * spring.task.scheduling.pool.size}.
 */
@Configuration
@EnableScheduling
class SchedulingConfig {

  @Bean(name = "taskScheduler")
  ThreadPoolTaskScheduler taskScheduler(ThreadPoolTaskSchedulerBuilder builder) {
    return builder.build();
  }
}
