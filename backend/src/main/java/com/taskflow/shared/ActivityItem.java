package com.taskflow.shared;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

public record ActivityItem(
    UUID id, String type, ActorType actorType, UUID actorId, JsonNode payload, Instant createdAt) {}
