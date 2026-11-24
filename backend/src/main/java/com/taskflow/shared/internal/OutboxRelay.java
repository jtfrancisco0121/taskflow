package com.taskflow.shared.internal;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Publishes committed outbox rows to the Redis channel {@code taskflow:events} (AD-11). One batch
 * per run inside one transaction: {@code FOR UPDATE SKIP LOCKED} lets several instances share the
 * table without publishing a row twice at the same time. Delivery is at least once; consumers check
 * versions. A row is marked published only after Redis accepted it.
 */
@Component
@ConditionalOnProperty(
    name = "taskflow.outbox.enabled",
    havingValue = "true",
    matchIfMissing = true)
class OutboxRelay {

  static final String CHANNEL = "taskflow:events";
  private static final Logger log = LoggerFactory.getLogger(OutboxRelay.class);

  private record Row(
      UUID id,
      UUID workspaceId,
      String entity,
      UUID entityId,
      String type,
      String payload,
      String actorType,
      UUID actorId,
      Timestamp createdAt) {}

  private final JdbcTemplate jdbc;
  private final StringRedisTemplate redis;
  private final ObjectMapper mapper;

  OutboxRelay(JdbcTemplate jdbc, StringRedisTemplate redis, ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.redis = redis;
    this.mapper = mapper;
  }

  @Scheduled(fixedDelayString = "${taskflow.outbox.interval-ms:250}")
  @Transactional
  public void relay() {
    List<Row> rows =
        jdbc.query(
            "SELECT id, workspace_id, entity, entity_id, type, payload::text AS payload, actor_type,"
                + " actor_id, created_at FROM outbox_event WHERE published_at IS NULL ORDER BY"
                + " created_at, id LIMIT 500 FOR UPDATE SKIP LOCKED",
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
                    rs.getTimestamp("created_at")));
    if (rows.isEmpty()) {
      return;
    }
    List<UUID> done = new ArrayList<>();
    try {
      for (Row r : rows) {
        redis.convertAndSend(CHANNEL, envelope(r));
        done.add(r.id());
      }
    } catch (RuntimeException e) {
      log.warn(
          "outbox relay stopped after {} of {} rows: {}", done.size(), rows.size(), e.toString());
    }
    if (!done.isEmpty()) {
      jdbc.update(
          "UPDATE outbox_event SET published_at = now() WHERE id = ANY (?::uuid[])",
          ps -> ps.setArray(1, ps.getConnection().createArrayOf("uuid", done.toArray())));
    }
  }

  private String envelope(Row r) {
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
      n.put("createdAt", r.createdAt().toInstant().toString());
      return mapper.writeValueAsString(n);
    } catch (java.io.IOException e) {
      throw new IllegalStateException("outbox row " + r.id() + " is not publishable", e);
    }
  }
}
