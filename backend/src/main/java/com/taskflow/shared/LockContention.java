package com.taskflow.shared;

import java.sql.SQLException;
import java.util.Set;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;

/**
 * Lock contention: deadlock (40P01), serialization failure (40001) or lock timeout (55P03). The
 * same request can succeed on retry. {@link #isContention} is the one predicate and {@link #busy}
 * the one answer, 503 {@code request.busy} with Retry-After, shared by the global handler and
 * DependencyService (ClickUp 14yq6g334r6, 14yq6g334u1); sign-out uses the predicate only. Spring
 * maps 40P01 and 40001 to {@link PessimisticLockingFailureException} but may leave 55P03
 * uncategorized, so the SQLSTATE in the cause chain is read too.
 */
public final class LockContention {

  private static final Set<String> STATES = Set.of("40P01", "40001", "55P03");

  private LockContention() {}

  public static boolean isContention(Throwable error) {
    Throwable t = error;
    for (int depth = 0; t != null && depth < 20; depth++) {
      if (t instanceof PessimisticLockingFailureException
          || (t instanceof SQLException sql && STATES.contains(sql.getSQLState()))) {
        return true;
      }
      if (t.getCause() == t) {
        break;
      }
      t = t.getCause();
    }
    return false;
  }

  /**
   * The answer to contention: 503 request.busy, Retry-After 1 second. A new exception each call.
   */
  public static TaskflowException busy() {
    return new TaskflowException(
            HttpStatus.SERVICE_UNAVAILABLE, "request.busy", "The server is busy; retry shortly")
        .header(HttpHeaders.RETRY_AFTER, "1");
  }
}
