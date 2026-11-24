package com.taskflow.shared.internal;

import java.util.Optional;
import java.util.UUID;

/**
 * The {@code X-Client-Id} of the current request (AD-12, AD-17). A ThreadLocal that {@link
 * ClientIdFilter} sets and clears, so it is empty outside an HTTP request: the nightly purge and
 * listeners on other threads read an empty value and never throw.
 */
public final class ClientIdHolder {

  private static final ThreadLocal<UUID> CURRENT = new ThreadLocal<>();

  private ClientIdHolder() {}

  public static Optional<UUID> current() {
    return Optional.ofNullable(CURRENT.get());
  }

  static void set(UUID id) {
    CURRENT.set(id);
  }

  static void clear() {
    CURRENT.remove();
  }
}
