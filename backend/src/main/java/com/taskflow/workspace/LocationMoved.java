package com.taskflow.workspace;

import java.util.List;
import java.util.UUID;

/**
 * Published in the moving transaction when a location got a new parent. {@code lists} holds every
 * List in the moved subtree, so task can remap statuses that left their scope.
 */
public record LocationMoved(
    UUID locationId, UUID workspaceId, UUID oldParentId, UUID newParentId, List<UUID> lists) {}
