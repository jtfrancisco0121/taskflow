package com.taskflow.automation.internal;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/**
 * An outbox event as the consumer sees it. {@code depth} and {@code causeRuleId} come from the
 * payload's {@code automation} block, which is present only when a rule made the change (AD-5).
 */
record EngineEvent(
    UUID id,
    UUID workspaceId,
    UUID taskId,
    String type,
    JsonNode payload,
    Instant createdAt,
    int depth,
    UUID causeRuleId) {

  JsonNode changes() {
    return payload.path("changes");
  }

  static EngineEvent parse(JsonNode envelope) {
    JsonNode payload = envelope.path("payload");
    JsonNode automation = payload.path("automation");
    UUID cause = null;
    if (automation.hasNonNull("ruleId")) {
      cause = UUID.fromString(automation.get("ruleId").asText());
    }
    return new EngineEvent(
        UUID.fromString(envelope.get("id").asText()),
        UUID.fromString(envelope.get("workspaceId").asText()),
        UUID.fromString(envelope.get("entityId").asText()),
        envelope.get("type").asText(),
        payload,
        Instant.parse(envelope.get("createdAt").asText()),
        automation.path("depth").asInt(0),
        cause);
  }
}
