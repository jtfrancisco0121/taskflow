package com.taskflow.field;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Public read access to custom field definitions with inheritance (AD-1, AD-4). */
public interface FieldCatalog {

  /**
   * The effective fields of a location: live fields defined at it or any ancestor, minus the ones
   * hidden at it or an ancestor, Space-level first, then in rank order. Empty when the location is
   * unknown.
   */
  List<FieldInfo> effective(UUID locationId);

  /** A field by id, retired ones included. */
  Optional<FieldInfo> lookup(UUID fieldId);

  /**
   * Validates custom field values for a task of this List (AD-1, field-types.md). Keys are field
   * ids or names of the List's effective fields; a value is the type's JSON shape, an Option or its
   * name for Dropdown and Labels; {@code null} (and {@code false} for a Checkbox, 0 for a Rating)
   * clears. Throws 400 {@code field.invalid_value} naming the field, or {@code field.not_available}
   * for a field that is not effective on the List.
   */
  ValidatedValues validate(UUID listId, Map<String, JsonNode> values);

  /**
   * The stored values of the effective fields as the API shows them (AD-13): values of fields
   * outside {@code effective} are dropped, retired Options are filtered out. Keys are field ids.
   */
  Map<String, JsonNode> project(List<FieldInfo> effective, Map<String, JsonNode> stored);

  /** A short display text of a stored value, for activity snapshots. */
  String display(FieldInfo field, JsonNode stored);
}
