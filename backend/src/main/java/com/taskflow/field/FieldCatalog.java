package com.taskflow.field;

import java.util.List;
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
}
