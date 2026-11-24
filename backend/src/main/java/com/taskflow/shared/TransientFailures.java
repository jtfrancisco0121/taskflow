package com.taskflow.shared;

import java.sql.SQLException;
import java.sql.SQLRecoverableException;
import java.sql.SQLTransientException;
import org.springframework.amqp.AmqpException;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.dao.RecoverableDataAccessException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.transaction.TransactionSystemException;

/**
 * The one classifier that decides whether a consumer failure is worth retrying (AD-4). Transient: a
 * database or broker error that can recover (restart, deadlock, lock timeout, pool timeout).
 * Everything else, such as an integrity violation or a malformed message, is terminal and goes to
 * the dead-letter queue on the first attempt.
 */
public final class TransientFailures {

  private TransientFailures() {}

  public static boolean isTransient(Throwable error) {
    Throwable t = error;
    for (int depth = 0; t != null && depth < 20; depth++) {
      if (transientType(t)) {
        return true;
      }
      if (t.getCause() == t) {
        break;
      }
      t = t.getCause();
    }
    return false;
  }

  private static boolean transientType(Throwable t) {
    if (t instanceof TransientMessageException
        || t instanceof TransientDataAccessException
        || t instanceof RecoverableDataAccessException
        || t instanceof CannotGetJdbcConnectionException
        || t instanceof CannotCreateTransactionException
        || t instanceof PessimisticLockingFailureException
        || t instanceof CannotAcquireLockException
        || t instanceof QueryTimeoutException
        || t instanceof SQLTransientException
        || t instanceof SQLRecoverableException
        || t instanceof AmqpException) {
      return true;
    }
    if (t instanceof TransactionSystemException tse) {
      // A commit that failed on a lost connection: the cause chain carries the SQL error.
      return tse.getCause() != null && isTransientSql(tse.getCause());
    }
    return t instanceof SQLException sql && transientState(sql.getSQLState());
  }

  private static boolean isTransientSql(Throwable cause) {
    return cause instanceof SQLException sql
        ? transientState(sql.getSQLState()) || sql instanceof SQLTransientException
        : cause instanceof SQLRecoverableException;
  }

  private static boolean transientState(String state) {
    return state != null
        && (state.startsWith("08")
            || state.startsWith("40")
            || state.startsWith("53")
            || state.startsWith("57P"));
  }
}
