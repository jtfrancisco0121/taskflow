package com.taskflow.identity;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;

/** Public lookup of API key names, for attribution in activity (KEY-6). */
public interface ApiKeyDirectory {

  /** Key id to key name. Unknown ids are absent. Revoked keys are still named. */
  Map<UUID, String> namesByIds(Collection<UUID> keyIds);
}
