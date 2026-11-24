package com.taskflow.field;

import java.util.UUID;

/** A live Option of a DROPDOWN or LABELS field. {@code color} is a palette name such as "blue". */
public record OptionInfo(UUID id, String name, String color) {}
