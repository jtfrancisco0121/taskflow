package com.taskflow.shared;

import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/** The only way a module reads the caller (AD-4). */
public final class CurrentActor {

  private CurrentActor() {}

  public static Optional<Actor> find() {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    if (authentication != null && authentication.getPrincipal() instanceof Actor actor) {
      return Optional.of(actor);
    }
    return Optional.empty();
  }

  public static Actor require() {
    return find()
        .orElseThrow(() ->
            new TaskflowException(
                HttpStatus.UNAUTHORIZED, "auth.unauthenticated", "Authentication required"));
  }

  public static UUID userId() {
    return require().id();
  }
}
