package com.taskflow.automation.internal;

import com.taskflow.shared.EventQueues;
import org.springframework.amqp.core.Declarables;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** The automation queue: bound to every task event, with its DLQ (AD-2). */
@Configuration
@ConditionalOnProperty(
    name = "taskflow.workers.enabled",
    havingValue = "true",
    matchIfMissing = true)
class AutomationQueueConfig {

  @Bean
  Declarables automationQueue() {
    return EventQueues.declare(AutomationConsumer.QUEUE, "task.*");
  }
}
