package com.taskflow.shared;

import java.util.UUID;

/** The authenticated principal (AD-4). Service accounts and automations are reserved. */
public record Actor(ActorType type, UUID id) {

  /** Actor for scheduled jobs that have no caller. */
  public static final Actor SYSTEM = new Actor(ActorType.AUTOMATION, new UUID(0L, 0L));

  public static Actor user(UUID id) {
    return new Actor(ActorType.USER, id);
  }
}
