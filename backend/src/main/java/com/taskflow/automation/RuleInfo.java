package com.taskflow.automation;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/** A rule as other modules and tests see it. The documents are the stored JSON. */
public record RuleInfo(
    UUID id,
    UUID workspaceId,
    UUID locationId,
    String name,
    boolean enabled,
    JsonNode trigger,
    JsonNode conditions,
    JsonNode actions,
    long version,
    UUID createdBy) {}
