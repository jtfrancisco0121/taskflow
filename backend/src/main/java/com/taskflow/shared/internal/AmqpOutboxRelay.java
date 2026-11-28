package com.taskflow.shared.internal;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.taskflow.shared.EventQueues;
import com.taskflow.shared.LockTimeout;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Publishes committed outbox rows to the RabbitMQ exchange {@code taskflow.events} (AD-2). It never
 * holds an outbox row lock while it talks to the broker: it claims rows with a lease in a short
 * committed transaction, publishes outside any transaction, waits for publisher confirms, and only
 * then marks {@code queued_at} for the confirmed rows. A row that was not confirmed is published
 * again once its lease expires, so delivery is at least once and consumers key on the message id.
 */
@Component
@ConditionalOnProperty(
    name = "taskflow.outbox.amqp.enabled",
    havingValue = "true",
    matchIfMissing = true)
class AmqpOutboxRelay {

  private static final Logger log = LoggerFactory.getLogger(AmqpOutboxRelay.class);

  private record Row(
      UUID id,
      UUID workspaceId,
      String entity,
      UUID entityId,
      String type,
      String payload,
      String actorType,
      UUID actorId,
      UUID actorKeyId,
      Timestamp createdAt) {}

  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final RabbitTemplate rabbit;
  private final ConnectionFactory connections;
  private final ObjectMapper mapper;
  private final long leaseSeconds;
  private final long confirmTimeoutMs;

  AmqpOutboxRelay(
      JdbcTemplate jdbc,
      TransactionTemplate tx,
      RabbitTemplate rabbit,
      ConnectionFactory connections,
      ObjectMapper mapper,
      @org.springframework.beans.factory.annotation.Value(
              "${taskflow.outbox.amqp.lease-seconds:30}")
          long leaseSeconds,
      @org.springframework.beans.factory.annotation.Value(
              "${taskflow.outbox.amqp.confirm-timeout-ms:5000}")
          long confirmTimeoutMs) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.rabbit = rabbit;
    this.connections = connections;
    this.mapper = mapper;
    this.leaseSeconds = leaseSeconds;
    this.confirmTimeoutMs = confirmTimeoutMs;
  }

  @Scheduled(fixedDelayString = "${taskflow.outbox.amqp.interval-ms:250}")
  public void relay() {
    if (!brokerReachable()) {
      return;
    }
    List<Row> rows = claim();
    if (rows.isEmpty()) {
      return;
    }
    List<UUID> confirmed = publish(rows);
    if (!confirmed.isEmpty()) {
      mark(confirmed);
    }
  }

  private boolean brokerReachable() {
    try {
      var connection = connections.createConnection();
      boolean open = connection.isOpen();
      connection.close();
      return open;
    } catch (RuntimeException e) {
      log.debug("amqp relay skipped, broker not reachable: {}", e.toString());
      return false;
    }
  }

  /** Claims up to 500 rows with a lease and commits, so no row lock is held while publishing. */
  private List<Row> claim() {
    return tx.execute(status ->
        jdbc.query(
            "UPDATE outbox_event SET queue_claimed_until = now() + make_interval(secs => ?)"
                + " WHERE id IN (SELECT id FROM outbox_event WHERE queued_at IS NULL AND"
                + " (queue_claimed_until IS NULL OR queue_claimed_until < now())"
                + " ORDER BY created_at, id LIMIT 500 FOR UPDATE SKIP LOCKED)"
                + " RETURNING id, workspace_id, entity, entity_id, type, payload::text AS"
                + " payload, actor_type, actor_id, actor_key_id, created_at",
            (rs, i) ->
                new Row(
                    rs.getObject("id", UUID.class),
                    rs.getObject("workspace_id", UUID.class),
                    rs.getString("entity"),
                    rs.getObject("entity_id", UUID.class),
                    rs.getString("type"),
                    rs.getString("payload"),
                    rs.getString("actor_type"),
                    rs.getObject("actor_id", UUID.class),
                    rs.getObject("actor_key_id", UUID.class),
                    rs.getTimestamp("created_at")),
            (double) leaseSeconds));
  }

  private List<UUID> publish(List<Row> rows) {
    // The claim returns rows in no guaranteed order; keep per-entity ordering stable.
    List<Row> ordered = new ArrayList<>(rows);
    ordered.sort(
        java.util.Comparator.comparing(Row::createdAt)
            .thenComparing(Row::id, java.util.Comparator.naturalOrder()));
    List<CorrelationData> sent = new ArrayList<>();
    try {
      for (Row r : ordered) {
        CorrelationData cd = new CorrelationData(r.id().toString());
        rabbit.send(EventQueues.EXCHANGE, r.type(), message(r), cd);
        sent.add(cd);
      }
    } catch (RuntimeException e) {
      log.warn(
          "amqp relay stopped after {} of {} rows: {}", sent.size(), rows.size(), e.toString());
    }
    List<UUID> confirmed = new ArrayList<>();
    long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(confirmTimeoutMs);
    for (CorrelationData cd : sent) {
      long left = Math.max(1, TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime()));
      try {
        var confirm = cd.getFuture().get(left, TimeUnit.MILLISECONDS);
        if (confirm.isAck()) {
          confirmed.add(UUID.fromString(cd.getId()));
        }
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        break;
      } catch (Exception e) {
        log.warn("amqp relay: no confirm for {}: {}", cd.getId(), e.toString());
      }
    }
    return confirmed;
  }

  private void mark(List<UUID> ids) {
    try {
      tx.executeWithoutResult(status -> {
        LockTimeout.set(jdbc, Duration.ofSeconds(2));
        jdbc.update(
            "UPDATE outbox_event SET queued_at = now() WHERE id = ANY (?::uuid[])",
            ps -> ps.setArray(1, ps.getConnection().createArrayOf("uuid", ids.toArray())));
      });
    } catch (RuntimeException e) {
      // The rows stay claimed; they are published again after the lease and consumers dedupe.
      log.warn("amqp relay could not mark {} rows queued: {}", ids.size(), e.toString());
    }
  }

  private Message message(Row r) {
    try {
      ObjectNode n = mapper.createObjectNode();
      n.put("id", r.id().toString());
      n.put("workspaceId", r.workspaceId().toString());
      n.put("entity", r.entity());
      n.put("entityId", r.entityId().toString());
      n.put("type", r.type());
      n.set("payload", mapper.readTree(r.payload()));
      n.put("actorType", r.actorType());
      n.put("actorId", r.actorId().toString());
      if (r.actorKeyId() != null) {
        n.put("actorKeyId", r.actorKeyId().toString());
      }
      n.put("createdAt", r.createdAt().toInstant().toString());
      MessageProperties props = new MessageProperties();
      props.setMessageId(r.id().toString());
      props.setType(r.type());
      props.setContentType(MessageProperties.CONTENT_TYPE_JSON);
      props.setContentEncoding(StandardCharsets.UTF_8.name());
      props.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
      return new Message(mapper.writeValueAsBytes(n), props);
    } catch (java.io.IOException e) {
      throw new IllegalStateException("outbox row " + r.id() + " is not publishable", e);
    }
  }
}
