package com.taskflow.workspace;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Public read access to the location tree for other modules. */
public interface LocationTree {

  /** The location with this id, including archived and deleted ones. */
  Optional<LocationInfo> find(UUID locationId);

  /**
   * Ids of every List at or under this location (the location itself when it is a List), including
   * archived and deleted ones so trashed tasks are covered too. Empty when the location is unknown.
   */
  List<UUID> listIdsAtOrUnder(UUID locationId);

  /**
   * Ids of every location of any type at or under this location (the location itself included),
   * archived and deleted ones too. Empty when the location is unknown.
   */
  List<UUID> locationIdsAtOrUnder(UUID locationId);
}
