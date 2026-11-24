package com.taskflow.task.internal;

import java.time.Instant;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/** The daily purge. Turn it off with {@code taskflow.purge.enabled=false}. */
@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "taskflow.purge.enabled", havingValue = "true", matchIfMissing = true)
class TaskPurgeScheduler {

  private final TaskPurgeService purge;

  TaskPurgeScheduler(TaskPurgeService purge) {
    this.purge = purge;
  }

  @Scheduled(cron = "${taskflow.purge.cron:0 15 3 * * *}")
  void run() {
    purge.purge(Instant.now());
  }
}
