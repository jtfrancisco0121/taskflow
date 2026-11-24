package com.taskflow.shared;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/** One activity row. {@code actorKeyId} is the API key of a service account, else null. */
public record ActivityItem(
    UUID id,
    String entity,
    UUID entityId,
    String type,
    ActorType actorType,
    UUID actorId,
    UUID actorKeyId,
    JsonNode payload,
    Instant createdAt) {}
