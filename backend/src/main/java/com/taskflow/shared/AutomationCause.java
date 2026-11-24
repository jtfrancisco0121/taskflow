package com.taskflow.shared;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.context.SecurityContextImpl;

/**
 * The cause of every change made while an automation rule runs (AD-5). It is bound to the thread
 * for the duration of {@link #run}: {@link EventRecorder} adds it to both the outbox and the
 * activity payload, the security principal is {@code Actor(AUTOMATION, ruleId)}, and the permission
 * evaluator resolves that actor to ADMIN in this Workspace only (AD-8). Both are cleared in {@code
 * finally}.
 */
public record AutomationCause(
    UUID workspaceId, UUID ruleId, String ruleName, UUID runId, int depth) {

  private static final ThreadLocal<AutomationCause> CURRENT = new ThreadLocal<>();

  public static Optional<AutomationCause> current() {
    return Optional.ofNullable(CURRENT.get());
  }

  public static void run(AutomationCause cause, Runnable body) {
    call(
        cause,
        () -> {
          body.run();
          return null;
        });
  }

  public static <T> T call(AutomationCause cause, Supplier<T> body) {
    AutomationCause previousCause = CURRENT.get();
    SecurityContext previousContext = SecurityContextHolder.getContext();
    try {
      CURRENT.set(cause);
      SecurityContext context = new SecurityContextImpl();
      context.setAuthentication(
          new UsernamePasswordAuthenticationToken(
              new Actor(ActorType.AUTOMATION, cause.ruleId()), null, List.of()));
      SecurityContextHolder.setContext(context);
      return body.get();
    } finally {
      if (previousCause == null) {
        CURRENT.remove();
      } else {
        CURRENT.set(previousCause);
      }
      SecurityContextHolder.setContext(previousContext);
    }
  }
}
