package com.taskflow.field;

import java.util.Map;
import java.util.UUID;

/**
 * Published in the changing transaction when a location's status set was replaced or reset. {@code
 * remap} maps every removed status id to the status that replaces it; task applies it to the tasks
 * of every List that resolved the old set.
 */
public record StatusSetChanged(UUID workspaceId, UUID locationId, Map<UUID, UUID> remap) {}
