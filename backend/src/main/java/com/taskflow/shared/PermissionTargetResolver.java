package com.taskflow.shared;

import java.util.Optional;
import java.util.UUID;

/** SPI: a module registers how its resource type maps to a location (AD-3). */
public interface PermissionTargetResolver {

  /** The permission type this resolver answers, for example TASK. */
  String type();

  Optional<PermissionTarget> resolve(UUID id);
}
