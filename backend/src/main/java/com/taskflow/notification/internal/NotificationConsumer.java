package com.taskflow.notification.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.shared.EventQueues;
import io.micrometer.core.instrument.MeterRegistry;
import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Turns outbox events into notifications and watcher changes (CAP-9, CAP-10). One event is one
 * transaction in {@link NotificationProcessor}; nothing is caught here, so the listener container's
 * retry policy retries what {@code TransientFailures} accepts and dead-letters the rest (AD-4).
 */
@Component
@ConditionalOnProperty(
    name = "taskflow.workers.enabled",
    havingValue = "true",
    matchIfMissing = true)
class NotificationConsumer {

  static final String QUEUE = "taskflow.notification";
  private static final Logger log = LoggerFactory.getLogger(NotificationConsumer.class);

  private final ObjectMapper mapper;
  private final NotificationProcessor processor;
  private final MeterRegistry meters;

  NotificationConsumer(ObjectMapper mapper, NotificationProcessor processor, MeterRegistry meters) {
    this.mapper = mapper;
    this.processor = processor;
    this.meters = meters;
  }

  @RabbitListener(
      queues = QUEUE,
      containerFactory = EventQueues.LISTENER_FACTORY,
      concurrency = "${taskflow.notification.consumers:2}")
  public void onMessage(Message message) {
    JsonNode envelope;
    try {
      envelope = mapper.readTree(new String(message.getBody(), StandardCharsets.UTF_8));
    } catch (JsonProcessingException e) {
      log.error("notification event {} is not JSON", message.getMessageProperties().getMessageId());
      meters.counter("taskflow.notifications.failed", "transient", "false").increment();
      throw new IllegalArgumentException("malformed event", e);
    }
    try {
      processor.process(envelope);
    } catch (RuntimeException e) {
      boolean transientError = com.taskflow.shared.TransientFailures.isTransient(e);
      meters
          .counter("taskflow.notifications.failed", "transient", String.valueOf(transientError))
          .increment();
      if (!transientError) {
        log.error(
            "notification event {} failed terminally: {}",
            message.getMessageProperties().getMessageId(),
            e.toString());
      }
      throw e;
    }
  }
}
