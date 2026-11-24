package com.taskflow.notification.internal;

import java.util.UUID;
import org.springframework.stereotype.Component;

/** Per-person preferences per Workspace and kind (CAP-13). A missing row is the default. */
@Component
class PreferenceStore {

  boolean inApp(UUID workspaceId, UUID userId, String kind) {
    return true;
  }
}
