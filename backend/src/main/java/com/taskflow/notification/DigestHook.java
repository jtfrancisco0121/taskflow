package com.taskflow.notification;

import java.util.UUID;

/**
 * The seam for the email digest (DIGEST-1). The consumer hands a notification here when the
 * recipient has email digest on for its kind; 3C ships only a logging no-op and sends no mail.
 */
public interface DigestHook {

  record Entry(UUID notificationId, UUID workspaceId, UUID recipientId, String kind, UUID taskId) {}

  void accept(Entry entry);
}
