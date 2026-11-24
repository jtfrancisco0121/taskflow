package com.taskflow.field;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The result of {@link FieldCatalog#validate}: values to store (normalised, Option names already
 * resolved to ids), the fields to clear, and the definitions both sets refer to.
 */
public record ValidatedValues(
    Map<UUID, JsonNode> set, Set<UUID> cleared, Map<UUID, FieldInfo> fields) {

  public boolean isEmpty() {
    return set.isEmpty() && cleared.isEmpty();
  }

  public static ValidatedValues none() {
    return new ValidatedValues(Map.of(), Set.of(), Map.of());
  }
}
