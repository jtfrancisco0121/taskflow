package com.taskflow.identity;

import java.util.Collection;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Public lookup of users for other modules. */
public interface UserDirectory {

  Optional<UserInfo> byId(UUID id);

  /** Case-insensitive. */
  Optional<UserInfo> byEmail(String email);

  Map<UUID, UserInfo> byIds(Collection<UUID> ids);
}
