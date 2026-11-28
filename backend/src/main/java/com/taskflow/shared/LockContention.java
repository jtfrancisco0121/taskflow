package com.taskflow.shared;

import java.sql.SQLException;
import java.util.Set;
import org.springframework.dao.PessimisticLockingFailureException;

/**
 * Lock contention: deadlock (40P01), serialization failure (40001) or lock timeout (55P03). The
 * same request can succeed on retry. The one predicate behind the 503 with Retry-After, shared by
 * the global handler and DependencyService (ClickUp 14yq6g334r6). Spring maps 40P01 and 40001 to
 * {@link PessimisticLockingFailureException} but may leave 55P03 uncategorized, so the SQLSTATE in
 * the cause chain is read too.
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
}
