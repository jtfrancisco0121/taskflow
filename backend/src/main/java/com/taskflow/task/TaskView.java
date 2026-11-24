package com.taskflow.task;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * A task as the API returns it; {@code version} is also the ETag. {@code customFields} maps field
 * id to value for the task's effective fields only (AD-13).
 */
public record TaskView(
    UUID id,
    UUID workspaceId,
    UUID listId,
    UUID parentTaskId,
    UUID statusId,
    long number,
    String readableId,
    String title,
    JsonNode description,
    Priority priority,
    Instant startDate,
    Instant dueDate,
    List<UUID> assigneeIds,
    List<String> tags,
    long version,
    UUID createdBy,
    Instant createdAt,
    Instant updatedAt,
    Map<String, JsonNode> customFields) {}
