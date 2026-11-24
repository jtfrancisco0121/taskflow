package com.taskflow.shared;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The only writer of {@code outbox_event} and {@code activity_event} (AD-7). It joins the caller's
 * transaction and throws when there is none, so a change can never be recorded without its events
 * or the other way round.
 */
@Component
public class EventRecorder {

  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;

  EventRecorder(JdbcTemplate jdbc, ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.mapper = mapper;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void record(
      UUID workspaceId,
      String entity,
      UUID entityId,
      String type,
      Map<String, Object> payload,
      Actor actor) {
    String json;
    try {
      json = mapper.writeValueAsString(payload == null ? Map.of() : payload);
    } catch (JsonProcessingException e) {
      throw new IllegalArgumentException("event payload is not serializable", e);
    }
    jdbc.update(
        "INSERT INTO outbox_event (id, workspace_id, entity, entity_id, type, payload, actor_type,"
            + " actor_id) VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?)",
        Ids.newId(),
        workspaceId,
        entity,
        entityId,
        type,
        json,
        actor.type().name(),
        actor.id());
    jdbc.update(
        "INSERT INTO activity_event (id, workspace_id, entity, entity_id, type, payload,"
            + " actor_type, actor_id) VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?)",
        Ids.newId(),
        workspaceId,
        entity,
        entityId,
        type,
        json,
        actor.type().name(),
        actor.id());
  }

  /** Records on behalf of the current caller. */
  @Transactional(propagation = Propagation.MANDATORY)
  public void record(
      UUID workspaceId, String entity, UUID entityId, String type, Map<String, Object> payload) {
    record(workspaceId, entity, entityId, type, payload, CurrentActor.require());
  }
}
