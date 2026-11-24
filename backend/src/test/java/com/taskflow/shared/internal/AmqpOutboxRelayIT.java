package com.taskflow.shared.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.IntegrationTest;
import com.taskflow.shared.Actor;
import com.taskflow.shared.EventQueues;
import com.taskflow.shared.EventRecorder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.support.TransactionTemplate;

@DisplayName("CAP-5 outbox relay to RabbitMQ")
@TestPropertySource(properties = "taskflow.outbox.amqp.enabled=true")
class AmqpOutboxRelayIT extends IntegrationTest {

  @Autowired RabbitAdmin admin;
  @Autowired RabbitTemplate rabbit;
  @Autowired EventRecorder events;
  @Autowired TransactionTemplate tx;

  private String queue;

  @BeforeEach
  void bindTestQueue() {
    queue = "test." + UUID.randomUUID();
    admin.declareQueue(new Queue(queue, true, false, false));
    admin.declareBinding(
        new Binding(queue, Binding.DestinationType.QUEUE, EventQueues.EXCHANGE, "task.*", null));
  }

  @AfterEach
  void dropTestQueue() {
    admin.deleteQueue(queue);
  }

  private UUID record(UUID workspace, UUID entity, String type) {
    tx.executeWithoutResult(
        s -> events.record(workspace, "task", entity, type, Map.of("version", 1), Actor.SYSTEM));
    return jdbc.queryForObject(
        "SELECT id FROM outbox_event WHERE entity_id = ? AND type = ?", UUID.class, entity, type);
  }

  private List<Message> drain(int expectedAtLeast) throws Exception {
    List<Message> out = new ArrayList<>();
    long deadline = System.currentTimeMillis() + 8000;
    while (System.currentTimeMillis() < deadline) {
      Message m = rabbit.receive(queue, 200);
      if (m != null) {
        out.add(m);
      } else if (out.size() >= expectedAtLeast) {
        break;
      }
    }
    return out;
  }

  @Test
  void aRecordedEventArrivesWithItsTypeAsRoutingKeyAndItsIdAsMessageId() throws Exception {
    UUID entity = UUID.randomUUID();
    UUID id = record(UUID.randomUUID(), entity, "task.updated");
    // not bound: notification.* never reaches the task queue
    record(UUID.randomUUID(), UUID.randomUUID(), "notification.created");

    List<Message> got = drain(1);
    Message mine =
        got.stream()
            .filter(m -> id.toString().equals(m.getMessageProperties().getMessageId()))
            .findFirst()
            .orElseThrow();
    JsonNode body = mapper.readTree(new String(mine.getBody(), StandardCharsets.UTF_8));
    assertThat(mine.getMessageProperties().getReceivedRoutingKey()).isEqualTo("task.updated");
    assertThat(body.get("entityId").asText()).isEqualTo(entity.toString());
    assertThat(body.at("/payload/version").asInt()).isEqualTo(1);
    assertThat(got)
        .noneMatch(m -> "notification.created".equals(m.getMessageProperties().getType()));
    // queued_at is set only after the confirm; the Redis marker is independent
    long deadline = System.currentTimeMillis() + 3000;
    while (System.currentTimeMillis() < deadline && queuedAt(id) == null) {
      Thread.sleep(50);
    }
    assertThat(queuedAt(id)).isNotNull();
  }

  private Object queuedAt(UUID id) {
    return jdbc.queryForObject("SELECT queued_at FROM outbox_event WHERE id = ?", Object.class, id);
  }

  @Test
  void rowsThatExistedBeforeTheMigrationAreNeverQueued() throws Exception {
    UUID entity = UUID.randomUUID();
    jdbc.update("UPDATE outbox_event SET queued_at = now() WHERE queued_at IS NULL");
    jdbc.update(
        "INSERT INTO outbox_event (id, workspace_id, entity, entity_id, type, payload, actor_type,"
            + " actor_id, created_at, queued_at) VALUES (?, ?, 'task', ?, 'task.created',"
            + " '{}'::jsonb, 'USER', ?, now() - interval '3 days', now())",
        UUID.randomUUID(),
        UUID.randomUUID(),
        entity,
        UUID.randomUUID());
    Thread.sleep(1200);
    assertThat(drain(0))
        .noneMatch(
            m -> new String(m.getBody(), StandardCharsets.UTF_8).contains(entity.toString()));
  }

  @Test
  void anExpiredClaimIsPublishedAgainWithTheSameMessageId() throws Exception {
    UUID id = record(UUID.randomUUID(), UUID.randomUUID(), "task.created");
    assertThat(drain(1))
        .anyMatch(m -> id.toString().equals(m.getMessageProperties().getMessageId()));
    long deadline = System.currentTimeMillis() + 3000;
    while (System.currentTimeMillis() < deadline && queuedAt(id) == null) {
      Thread.sleep(50);
    }
    // the relay died before marking: the row is unmarked and its lease has run out
    jdbc.update(
        "UPDATE outbox_event SET queued_at = NULL, queue_claimed_until = now() - interval '1 second'"
            + " WHERE id = ?",
        id);
    List<Message> again = drain(1);
    long copies =
        again.stream()
            .filter(m -> id.toString().equals(m.getMessageProperties().getMessageId()))
            .count();
    assertThat(copies).isEqualTo(1);
  }

  @Test
  void aLiveClaimIsNotPublishedByASecondRelay() throws Exception {
    UUID id = UUID.randomUUID();
    UUID entity = UUID.randomUUID();
    jdbc.update(
        "INSERT INTO outbox_event (id, workspace_id, entity, entity_id, type, payload, actor_type,"
            + " actor_id, queue_claimed_until) VALUES (?, ?, 'task', ?, 'task.updated', '{}'::jsonb,"
            + " 'USER', ?, now() + interval '1 minute')",
        id,
        UUID.randomUUID(),
        entity,
        UUID.randomUUID());
    Thread.sleep(1000);
    assertThat(drain(0))
        .noneMatch(m -> id.toString().equals(m.getMessageProperties().getMessageId()));
    assertThat(queuedAt(id)).isNull();
  }
}
