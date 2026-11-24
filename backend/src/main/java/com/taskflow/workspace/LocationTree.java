package com.taskflow.workspace;

import java.util.Optional;
import java.util.UUID;

/** Public read access to the location tree for other modules. */
public interface LocationTree {

  /** The location with this id, including archived and deleted ones. */
  Optional<LocationInfo> find(UUID locationId);
}
