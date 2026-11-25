package com.taskflow.shared;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.SQLException;
import java.sql.SQLRecoverableException;
import java.sql.SQLTransientConnectionException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.AmqpConnectException;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DeadlockLoserDataAccessException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.dao.RecoverableDataAccessException;
import org.springframework.dao.TransientDataAccessResourceException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.transaction.TransactionSystemException;

@DisplayName("AD-4 one classifier for transient failures")
class TransientFailuresTest {

  @Test
  void transientKindsAreRetried() {
    assertThat(TransientFailures.isTransient(new TransientMessageException("again"))).isTrue();
    assertThat(TransientFailures.isTransient(new TransientDataAccessResourceException("x")))
        .isTrue();
    assertThat(TransientFailures.isTransient(new RecoverableDataAccessException("x"))).isTrue();
    assertThat(TransientFailures.isTransient(new CannotCreateTransactionException("x"))).isTrue();
    assertThat(TransientFailures.isTransient(new DeadlockLoserDataAccessException("x", null)))
        .isTrue();
    assertThat(TransientFailures.isTransient(new CannotAcquireLockException("x"))).isTrue();
    assertThat(TransientFailures.isTransient(new QueryTimeoutException("x"))).isTrue();
    assertThat(TransientFailures.isTransient(new AmqpConnectException(new RuntimeException())))
        .isTrue();
    assertThat(TransientFailures.isTransient(new SQLRecoverableException("gone"))).isTrue();
  }

  @Test
  void aHikariTimeoutIsRetriedEvenThoughSpringFilesItAsNonTransient() {
    var timeout =
        new CannotGetJdbcConnectionException(
            "Failed to obtain JDBC Connection", new SQLTransientConnectionException("timeout"));
    assertThat(TransientFailures.isTransient(timeout)).isTrue();
  }

  @Test
  void sqlStateClassesAreClassified() {
    assertThat(TransientFailures.isTransient(new SQLException("x", "08006"))).isTrue();
    assertThat(TransientFailures.isTransient(new SQLException("x", "40P01"))).isTrue();
    assertThat(TransientFailures.isTransient(new SQLException("x", "53300"))).isTrue();
    assertThat(TransientFailures.isTransient(new SQLException("x", "57P01"))).isTrue();
    assertThat(TransientFailures.isTransient(new SQLException("x", "23505"))).isFalse();
  }

  @Test
  void aCommitThatFailedOnALostConnectionIsRetried() {
    var lost = new TransactionSystemException("commit failed", new SQLException("x", "08006"));
    assertThat(TransientFailures.isTransient(lost)).isTrue();
    assertThat(TransientFailures.isTransient(new TransactionSystemException("rollback only")))
        .isFalse();
  }

  @Test
  void theCauseChainIsWalked() {
    var wrapped = new RuntimeException("listener failed", new QueryTimeoutException("slow"));
    assertThat(TransientFailures.isTransient(wrapped)).isTrue();
  }

  @Test
  void terminalFailuresAreNotRetried() {
    assertThat(TransientFailures.isTransient(new DataIntegrityViolationException("dup"))).isFalse();
    assertThat(
            TransientFailures.isTransient(
                new BadSqlGrammarException("t", "select", new SQLException("x", "42601"))))
        .isFalse();
    assertThat(TransientFailures.isTransient(new IllegalArgumentException("bad json"))).isFalse();
    assertThat(TransientFailures.isTransient(null)).isFalse();
    // a message that cannot be converted fails the same way every time, wrapper included
    var conversion =
        new org.springframework.amqp.support.converter.MessageConversionException("bad");
    assertThat(TransientFailures.isTransient(conversion)).isFalse();
    assertThat(
            TransientFailures.isTransient(
                new org.springframework.amqp.rabbit.support.ListenerExecutionFailedException(
                    "Failed to convert message", conversion)))
        .isFalse();
  }
}
