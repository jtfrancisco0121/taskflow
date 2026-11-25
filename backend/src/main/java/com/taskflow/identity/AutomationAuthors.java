package com.taskflow.identity;

import java.util.Collection;
import java.util.Set;
import java.util.UUID;

/**
 * The per-Workspace "Automation" app user that authors rule-made comments and subtasks (AD-9). It
 * is never a member and cannot authenticate.
 */
public interface AutomationAuthors {

  /** The Workspace's Automation user; created once, idempotently, on first use. */
  UUID authorFor(UUID workspaceId);

  /** Which of these ids are Automation users. */
  Set<UUID> authorsAmong(Collection<UUID> userIds);
}
