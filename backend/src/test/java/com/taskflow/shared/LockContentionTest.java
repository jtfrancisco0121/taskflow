package com.taskflow.shared;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.SQLException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.UncategorizedSQLException;

/** ClickUp 14yq6g334r6: one contention predicate for the 503 handler and the sign-out retry. */
@DisplayName("Lock contention predicate")
class LockContentionTest {

  @ParameterizedTest
  @ValueSource(strings = {"40P01", "40001", "55P03"})
  void deadlockSerializationAndLockTimeoutAreContention(String state) {
    var e = new UncategorizedSQLException("probe", "SELECT 1", new SQLException("x", state));

    assertThat(LockContention.isContention(e)).isTrue();
  }

  @Test
  void springsPessimisticLockingFailuresAreContention() {
    assertThat(LockContention.isContention(new CannotAcquireLockException("lock"))).isTrue();
    assertThat(LockContention.isContention(new PessimisticLockingFailureException("lock")))
        .isTrue();
  }

  @Test
  void otherDatabaseFailuresAreNot() {
    assertThat(LockContention.isContention(new DataAccessResourceFailureException("down")))
        .isFalse();
    assertThat(
            LockContention.isContention(
                new DataIntegrityViolationException("dup", new SQLException("dup", "23505"))))
        .isFalse();
    assertThat(LockContention.isContention(new IllegalStateException("x"))).isFalse();
    assertThat(LockContention.isContention(null)).isFalse();
  }

  /** ClickUp 14yq6g334u1: the one answer to contention, shared by every endpoint. */
  @Test
  void busyIs503RequestBusyWithRetryAfter() {
    TaskflowException busy = LockContention.busy();

    assertThat(busy.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    assertThat(busy.code()).isEqualTo("request.busy");
    assertThat(busy.headers()).containsEntry("Retry-After", "1");
  }

  @Test
  void eachBusyIsAFreshException() {
    assertThat(LockContention.busy()).isNotSameAs(LockContention.busy());
  }
}
