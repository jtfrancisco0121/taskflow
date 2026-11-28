package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.taskflow.shared.TaskflowException;
import java.sql.SQLException;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

/**
 * ClickUp 14yq6g334r6 slice 1, review round 2: every sign-out failure logs the family at ERROR
 * (never the token), and the locked revoke retries on any lock contention, not only 55P03.
 */
@DisplayName("AUTH-2 sign-out failure paths")
class AuthServiceSignOutTest {

  private static final String RAW = "raw-refresh-token-that-must-never-be-logged";

  private final UUID family = UUID.randomUUID();
  private final StubJdbc jdbc = new StubJdbc();
  private final AuthService auth =
      new AuthService(jdbc, new NoOpTransactions(), null, null, null, null);
  private final ListAppender<ILoggingEvent> logs = new ListAppender<>();
  private final Logger logger = (Logger) LoggerFactory.getLogger(AuthService.class);

  @BeforeEach
  void captureLogs() {
    logs.start();
    logger.addAppender(logs);
  }

  @AfterEach
  void releaseLogs() {
    logger.detachAppender(logs);
  }

  private static UncategorizedSQLException sqlState(String state) {
    return new UncategorizedSQLException("revoke", "SELECT 1", new SQLException("x", state));
  }

  private List<ILoggingEvent> errors() {
    return logs.list.stream().filter(e -> e.getLevel() == Level.ERROR).toList();
  }

  private void assertNoTokenLogged() {
    for (ILoggingEvent e : logs.list) {
      assertThat(e.getFormattedMessage()).doesNotContain(RAW);
      if (e.getThrowableProxy() != null) {
        assertThat(String.valueOf(e.getThrowableProxy().getMessage())).doesNotContain(RAW);
      }
    }
  }

  @Test
  void aDatabaseFailureIsLoggedWithTheFamilyAndRethrown() {
    var down = new DataAccessResourceFailureException("connection lost");
    jdbc.failures.add(down);

    assertThatThrownBy(() -> auth.signOut(RAW)).isSameAs(down);

    assertThat(jdbc.attempts).isEqualTo(1);
    assertThat(jdbc.revokes).isZero();
    assertThat(errors())
        .singleElement()
        .satisfies(e -> {
          assertThat(e.getFormattedMessage()).contains(family.toString());
        });
    assertNoTokenLogged();
  }

  @Test
  void deadlockAndSerializationFailuresAreRetriedUntilTheRevokeSucceeds() {
    jdbc.failures.add(sqlState("40P01"));
    jdbc.failures.add(sqlState("40001"));

    auth.signOut(RAW);

    assertThat(jdbc.attempts).isEqualTo(3);
    assertThat(jdbc.revokes).isEqualTo(1);
    assertThat(errors()).isEmpty();
  }

  @Test
  void contentionOnEveryAttemptIs503WithoutRetryAfterAndLogsTheFamily() {
    jdbc.failures.add(sqlState("55P03"));
    jdbc.failures.add(sqlState("40001"));
    jdbc.failures.add(sqlState("40P01"));

    assertThatThrownBy(() -> auth.signOut(RAW))
        .isInstanceOfSatisfying(
            TaskflowException.class,
            e -> {
              assertThat(e.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
              assertThat(e.code()).isEqualTo("request.busy");
              assertThat(e.headers()).doesNotContainKey("Retry-After");
            });

    assertThat(jdbc.attempts).isEqualTo(AuthService.SIGN_OUT_ATTEMPTS);
    assertThat(jdbc.revokes).isZero();
    assertThat(errors())
        .singleElement()
        .satisfies(e -> {
          assertThat(e.getFormattedMessage()).contains(family.toString());
        });
    assertNoTokenLogged();
  }

  /** The token's family is live; each attempt's first statement throws the next queued failure. */
  private final class StubJdbc extends JdbcTemplate {
    final Deque<RuntimeException> failures = new ArrayDeque<>();
    int attempts;
    int revokes;

    @Override
    public <T> List<T> queryForList(String sql, Class<T> type, Object... args) {
      return List.of(type.cast(family));
    }

    @Override
    public void execute(String sql) {
      attempts++;
      RuntimeException failure = failures.poll();
      if (failure != null) {
        throw failure;
      }
    }

    @Override
    public void query(String sql, RowCallbackHandler rch, Object... args) {}

    @Override
    public int update(String sql, Object... args) {
      revokes++;
      return 1;
    }
  }

  private static final class NoOpTransactions implements PlatformTransactionManager {
    @Override
    public TransactionStatus getTransaction(TransactionDefinition definition) {
      return new SimpleTransactionStatus();
    }

    @Override
    public void commit(TransactionStatus status) {}

    @Override
    public void rollback(TransactionStatus status) {}
  }
}
