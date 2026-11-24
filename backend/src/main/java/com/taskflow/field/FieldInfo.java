package com.taskflow.field;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * A custom field definition as other modules see it. {@code definedAt} is the Location that defines
 * it ({@code definedAtName} its name, for "from <Location>" captions); {@code options} holds the
 * live Options only.
 */
public record FieldInfo(
    UUID id,
    UUID workspaceId,
    UUID definedAt,
    String definedAtName,
    String name,
    FieldType type,
    Map<String, Object> config,
    List<OptionInfo> options,
    long version,
    boolean retired) {}
