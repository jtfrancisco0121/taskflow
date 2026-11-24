package com.taskflow.field;

import java.util.UUID;

/** A status of an effective set, in display order. */
public record StatusInfo(UUID id, String name, StatusGroup group, String color, UUID definedAt) {}
