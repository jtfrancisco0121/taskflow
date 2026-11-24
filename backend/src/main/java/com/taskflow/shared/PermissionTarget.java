package com.taskflow.shared;

import java.util.UUID;

/** Where a non-location resource lives: its workspace and home List. */
public record PermissionTarget(UUID workspaceId, UUID locationId, boolean trashed) {}
