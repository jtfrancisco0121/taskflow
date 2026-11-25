package com.taskflow.notification.internal;

import com.taskflow.shared.EventQueues;
import org.springframework.amqp.core.Declarables;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** The notification queue: task and comment events plus rule notification requests (AD-2). */
@Configuration
@ConditionalOnProperty(
    name = "taskflow.workers.enabled",
    havingValue = "true",
    matchIfMissing = true)
class NotificationQueueConfig {

  @Bean
  Declarables notificationQueue() {
    return EventQueues.declare(
        NotificationConsumer.QUEUE, "task.*", "comment.*", "automation.notify_requested");
  }
}
