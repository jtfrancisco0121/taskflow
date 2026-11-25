package com.taskflow.identity;

import java.util.Optional;
import java.util.UUID;

/** Public lookup of service accounts for other modules (SA-2). */
public interface ServiceAccounts {

  /** The Workspace of an enabled service account; empty for any other id (users included). */
  Optional<UUID> workspaceOf(UUID serviceAccountId);

  /** The person who created the service account (its owner), when there is one. */
  Optional<UUID> ownerOf(UUID serviceAccountId);
}
