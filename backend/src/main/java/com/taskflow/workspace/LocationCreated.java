package com.taskflow.workspace;

import java.util.UUID;

/** Published in the creating transaction, for example so field can seed a Space's statuses. */
public record LocationCreated(
    UUID locationId, UUID workspaceId, LocationType type, UUID parentId) {}
