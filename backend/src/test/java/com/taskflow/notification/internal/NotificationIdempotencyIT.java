package com.taskflow.notification.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.doAnswer;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

@DisplayName("CAP-9 idempotent creation and failure handling")
@TestPropertySource(
    properties = {"taskflow.workers.enabled=true", "taskflow.outbox.amqp.enabled=true"})
class NotificationIdempotencyIT extends NotificationSupport {

  @Autowired RabbitTemplate rabbit;
  @MockitoSpyBean NotificationProcessor processor;

  private boolean onDlq(String messageId) {
    long deadline = System.currentTimeMillis() + 4000;
    while (System.currentTimeMillis() < deadline) {
      Message m = rabbit.receive("taskflow.notification.dlq", 200);
      if (m != null && messageId.equals(m.getMessageProperties().getMessageId())) {
        return true;
      }
    }
    return false;
  }

  @Test
  void theSameMessageDeliveredTwiceCreatesOneNotification() {
    Fx f = fx();
    UUID task = taskFor(f.ws().owner(), f.list(), "T", f.ws().member().id());
    awaitKind(f.ws().member().id(), task, "ASSIGNED");
    UUID eventId =
        jdbc.queryForObject(
            "SELECT id FROM outbox_event WHERE entity_id = ? AND type = 'task.created'",
            UUID.class,
            task);
    await(
        () ->
            jdbc.queryForObject(
                "SELECT queued_at IS NOT NULL FROM outbox_event WHERE id = ?",
                Boolean.class,
                eventId),
        b -> b);
    jdbc.update(
        "UPDATE outbox_event SET queued_at = NULL, queue_claimed_until = NULL WHERE id = ?",
        eventId);
    await(
        () ->
            jdbc.queryForObject(
                "SELECT queued_at IS NOT NULL FROM outbox_event WHERE id = ?",
                Boolean.class,
                eventId),
        b -> b);
    pause(1500);
    assertThat(count(f.ws().member().id(), task, "ASSIGNED")).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE type = 'notification.created' AND"
                    + " (payload->>'recipientId') = ?",
                Long.class,
                f.ws().member().id().toString()))
        .isEqualTo(1);
  }

  @Test
  void aPoolTimeoutAfterTheWatcherInsertIsRetriedAndEndsWithOneNotificationAndNoDeadLetter() {
    Fx f = fx();
    AtomicInteger failures = new AtomicInteger();
    doAnswer(
            invocation -> {
              Object result = invocation.callRealMethod();
              if (failures.getAndIncrement() == 0) {
                // after the watcher insert, like a Hikari timeout on the next statement
                throw new CannotGetJdbcConnectionException(
                    "Failed to obtain JDBC Connection",
                    new java.sql.SQLTransientConnectionException("timeout"));
              }
              return result;
            })
        .when(processor)
        .watch(any(), any(), any(), anyBoolean());
    UUID task = taskFor(f.ws().owner(), f.list(), "T", f.ws().member().id());
    awaitKind(f.ws().member().id(), task, "ASSIGNED");
    pause(1500);
    assertThat(count(f.ws().member().id(), task, "ASSIGNED")).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM task_watcher WHERE task_id = ? AND user_id = ?",
                Long.class,
                task,
                f.ws().member().id()))
        .isEqualTo(1);
    assertThat(failures.get()).isGreaterThanOrEqualTo(2);
  }

  @Test
  void aMalformedMessageGoesToTheDeadLetterQueueAfterOneAttempt() {
    String id = UUID.randomUUID().toString();
    MessageProperties props = new MessageProperties();
    props.setMessageId(id);
    props.setContentType("application/json");
    rabbit.send(
        "taskflow.events",
        "comment.created",
        new Message("{not json".getBytes(StandardCharsets.UTF_8), props));
    assertThat(onDlq(id)).isTrue();
  }
}
