package com.taskflow.field;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Public read access to status sets with inheritance (AD-12, AD-13). */
public interface StatusCatalog {

  /** The effective set of a location: its nearest ancestor-or-self that defines one. */
  List<StatusInfo> effectiveSet(UUID locationId);

  boolean isValid(UUID listId, UUID statusId);

  /** The first NOT_STARTED status of the List's effective set. */
  Optional<UUID> firstNotStarted(UUID listId);

  /** The first status of the given group in the List's effective set, if any. */
  Optional<UUID> sameGroupFirst(UUID listId, StatusGroup group);

  /** A status by id, retired ones included. */
  Optional<StatusInfo> find(UUID statusId);
}
