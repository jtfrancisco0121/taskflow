package com.taskflow.shared;

import java.util.UUID;

/**
 * The authenticated principal (AD-4). {@code keyId} is the API key a service account used, and is
 * null for users and jobs.
 */
public record Actor(ActorType type, UUID id, UUID keyId) {

  /** Actor for scheduled jobs that have no caller. */
  public static final Actor SYSTEM = new Actor(ActorType.AUTOMATION, new UUID(0L, 0L));

  public Actor(ActorType type, UUID id) {
    this(type, id, null);
  }

  public static Actor user(UUID id) {
    return new Actor(ActorType.USER, id);
  }
}
