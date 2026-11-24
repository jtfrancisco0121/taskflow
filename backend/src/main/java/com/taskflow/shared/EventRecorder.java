package com.taskflow.shared;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.shared.internal.ClientIdHolder;
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
    String outboxJson;
    try {
      Map<String, Object> body = payload == null ? Map.of() : payload;
      // While a rule runs, its cause rides on every event it makes, in both payloads (AD-5).
      var cause = AutomationCause.current();
      if (cause.isPresent()) {
        Map<String, Object> withCause = new java.util.LinkedHashMap<>(body);
        AutomationCause c = cause.get();
        Map<String, Object> automation = new java.util.LinkedHashMap<>();
        automation.put("ruleId", c.ruleId().toString());
        automation.put("ruleName", c.ruleName());
        automation.put("runId", c.runId() == null ? null : c.runId().toString());
        automation.put("depth", c.depth());
        withCause.put("automation", automation);
        body = withCause;
      }
      json = mapper.writeValueAsString(body);
      // The client id is a tab id, not activity: it rides on the outbox row only (AD-12).
      var clientId = ClientIdHolder.current();
      if (clientId.isPresent()) {
        Map<String, Object> withClient = new java.util.LinkedHashMap<>(body);
        withClient.put("clientId", clientId.get().toString());
        outboxJson = mapper.writeValueAsString(withClient);
      } else {
        outboxJson = json;
      }
    } catch (JsonProcessingException e) {
      throw new IllegalArgumentException("event payload is not serializable", e);
    }
    jdbc.update(
        "INSERT INTO outbox_event (id, workspace_id, entity, entity_id, type, payload, actor_type,"
            + " actor_id, actor_key_id) VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?, ?)",
        Ids.newId(),
        workspaceId,
        entity,
        entityId,
        type,
        outboxJson,
        actor.type().name(),
        actor.id(),
        actor.keyId());
    jdbc.update(
        "INSERT INTO activity_event (id, workspace_id, entity, entity_id, type, payload,"
            + " actor_type, actor_id, actor_key_id) VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?,"
            + " ?)",
        Ids.newId(),
        workspaceId,
        entity,
        entityId,
        type,
        json,
        actor.type().name(),
        actor.id(),
        actor.keyId());
  }

  /** Records on behalf of the current caller. */
  @Transactional(propagation = Propagation.MANDATORY)
  public void record(
      UUID workspaceId, String entity, UUID entityId, String type, Map<String, Object> payload) {
    record(workspaceId, entity, entityId, type, payload, CurrentActor.require());
  }
}
