package com.taskflow.field;

import java.util.Map;
import java.util.UUID;

/**
 * Published in the changing transaction when a location's status set was replaced or reset. {@code
 * remap} maps every removed status id to the status that replaces it; task applies it to the tasks
 * of every List at or under {@code locationId}. {@code regrouped} maps every kept status whose
 * group changed to its old group: such a status is already updated when the event is handled, so
 * task cannot read the old finished-ness of its tasks any other way.
 */
public record StatusSetChanged(
    UUID workspaceId, UUID locationId, Map<UUID, UUID> remap, Map<UUID, StatusGroup> regrouped) {

  public StatusSetChanged(UUID workspaceId, UUID locationId, Map<UUID, UUID> remap) {
    this(workspaceId, locationId, remap, Map.of());
  }
}
