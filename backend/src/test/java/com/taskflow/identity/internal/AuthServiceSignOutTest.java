package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.taskflow.shared.TaskflowException;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

/**
 * ClickUp 14yq6g334r6 slice 2: sign-out records a pending revocation before its one locked attempt,
 * so a busy or failing family lock still signs out (the next refresh revokes the family). Every
 * failure that can leave the family live logs once at ERROR, with the family id or a token-hash
 * prefix, never the raw token and never a stack (the container would log it again).
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
    return new UncategorizedSQLException("lock", "SELECT 1", new SQLException("x", state));
  }

  private List<ILoggingEvent> at(Level level) {
    return logs.list.stream().filter(e -> e.getLevel() == level).toList();
  }

  private void assertNoTokenLogged() {
    for (ILoggingEvent e : logs.list) {
      assertThat(e.getFormattedMessage()).doesNotContain(RAW);
      if (e.getThrowableProxy() != null) {
        assertThat(String.valueOf(e.getThrowableProxy().getMessage())).doesNotContain(RAW);
      }
    }
  }

  private static void assertBusy(Throwable e) {
    assertThat(e)
        .isInstanceOfSatisfying(
            TaskflowException.class,
            t -> {
              assertThat(t.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
              assertThat(t.code()).isEqualTo("request.busy");
              assertThat(t.headers()).doesNotContainKey("Retry-After");
            });
  }

  @Test
  void aFreeFamilyIsRevokedAfterThePendingRowIsWritten() {
    auth.signOut(RAW);

    assertThat(jdbc.steps)
        .containsExactly(Step.LOOKUP, Step.PENDING, Step.LOCK, Step.REVOKE, Step.CLEAR_PENDING);
    assertThat(logs.list).isEmpty();
  }

  @Test
  void lockContentionIsOneAttemptThenANormalAnswerBecauseTheRowIsPending() {
    for (String state : List.of("55P03", "40P01", "40001")) {
      jdbc.steps.clear();
      logs.list.clear();
      jdbc.failures.put(Step.LOCK, sqlState(state));

      auth.signOut(RAW);

      assertThat(jdbc.steps).as(state).containsExactly(Step.LOOKUP, Step.PENDING, Step.LOCK);
      assertThat(at(Level.ERROR)).as(state).isEmpty();
      assertThat(at(Level.WARN))
          .as(state)
          .singleElement()
          .satisfies(e -> {
            assertThat(e.getFormattedMessage()).contains(family.toString());
            assertThat(e.getThrowableProxy()).isNull();
          });
      assertNoTokenLogged();
    }
  }

  /**
   * PR #36 review: in autocommit the server default lock_timeout (0, wait forever) applied, so the
   * insert could wait without limit on a revoking transaction that holds the same row.
   */
  @Test
  void thePendingRowIsWrittenInATransactionBoundedByTheLockTimeout() {
    auth.signOut(RAW);

    assertThat(jdbc.pendingBounded).isTrue();
  }

  /**
   * A lock timeout (or other contention) on the pending row means another transaction holds that
   * family's row: a revocation deleting it (commit revokes, rollback leaves the row) or a sign-out
   * writing it. The family ends either way, so with the locked attempt also busy this is a WARN and
   * a normal answer, not the 503 kept for a family that stays live.
   */
  @Test
  void contentionOnBothThePendingRowAndTheLockStillAnswersNormally() {
    for (String state : List.of("55P03", "40P01", "40001")) {
      jdbc.steps.clear();
      logs.list.clear();
      jdbc.failures.put(Step.PENDING, sqlState(state));
      jdbc.failures.put(Step.LOCK, sqlState("55P03"));

      auth.signOut(RAW);

      assertThat(jdbc.steps)
          .as(state)
          .containsExactly(Step.LOOKUP, Step.PENDING, Step.LOCK, Step.CONFIRM);
      assertThat(at(Level.ERROR)).as(state).isEmpty();
      assertThat(at(Level.WARN))
          .as(state)
          .isNotEmpty()
          .allSatisfy(e -> {
            assertThat(e.getFormattedMessage()).contains(family.toString());
            assertThat(e.getThrowableProxy()).isNull();
          });
      assertNoTokenLogged();
    }
  }

  @Test
  void aDatabaseErrorOnTheLockedAttemptIsAlsoDeferredToThePendingRow() {
    jdbc.failures.put(Step.LOCK, new DataAccessResourceFailureException("connection lost"));

    auth.signOut(RAW);

    assertThat(jdbc.steps).containsExactly(Step.LOOKUP, Step.PENDING, Step.LOCK);
    assertThat(at(Level.ERROR)).isEmpty();
    assertThat(at(Level.WARN)).singleElement();
    assertNoTokenLogged();
  }

  @Test
  void aFailedFamilyLookupLogsOneErrorWithAHashPrefixAndNoToken() {
    jdbc.failures.put(Step.LOOKUP, new CannotGetJdbcConnectionException("pool timeout"));

    Throwable thrown = org.assertj.core.api.Assertions.catchThrowable(() -> auth.signOut(RAW));

    assertBusy(thrown);
    assertThat(jdbc.steps).containsExactly(Step.LOOKUP);
    assertThat(logs.list)
        .singleElement()
        .satisfies(e -> {
          assertThat(e.getLevel()).isEqualTo(Level.ERROR);
          assertThat(e.getFormattedMessage())
              .contains(AuthService.sha256(RAW).substring(0, 12))
              .contains("CannotGetJdbcConnectionException")
              .doesNotContain(AuthService.sha256(RAW));
          assertThat(e.getThrowableProxy()).isNull();
        });
    assertNoTokenLogged();
  }

  @Test
  void aFailedPendingRowWriteStillTriesTheLockedRevoke() {
    jdbc.failures.put(Step.PENDING, new DataAccessResourceFailureException("connection lost"));

    auth.signOut(RAW);

    assertThat(jdbc.steps)
        .containsExactly(Step.LOOKUP, Step.PENDING, Step.LOCK, Step.REVOKE, Step.CLEAR_PENDING);
    assertThat(at(Level.ERROR)).isEmpty();
    assertNoTokenLogged();
  }

  @Test
  void whenNeitherThePendingRowNorTheRevokeLandsItLogsOneErrorWithTheFamily() {
    jdbc.failures.put(Step.PENDING, new DataAccessResourceFailureException("connection lost"));
    jdbc.failures.put(Step.LOCK, sqlState("55P03"));

    Throwable thrown = org.assertj.core.api.Assertions.catchThrowable(() -> auth.signOut(RAW));

    assertBusy(thrown);
    assertThat(jdbc.steps).containsExactly(Step.LOOKUP, Step.PENDING, Step.LOCK);
    assertThat(logs.list)
        .singleElement()
        .satisfies(e -> {
          assertThat(e.getLevel()).isEqualTo(Level.ERROR);
          assertThat(e.getFormattedMessage()).contains(family.toString());
          assertThat(e.getThrowableProxy()).isNull();
        });
    assertNoTokenLogged();
  }

  /**
   * ClickUp 14yq6g3353g: the transaction holding the row may be an insert that rolls back. With the
   * locked attempt busy too, sign-out answers normally only if the family is sure to end.
   */
  @Test
  void contentionOnBothWhenTheFamilyIsNotSureToEndLogsOneErrorAndAnswersBusy() {
    jdbc.failures.put(Step.PENDING, sqlState("55P03"));
    jdbc.failures.put(Step.LOCK, sqlState("55P03"));
    jdbc.familySureToEnd = false;

    Throwable thrown = org.assertj.core.api.Assertions.catchThrowable(() -> auth.signOut(RAW));

    assertBusy(thrown);
    assertThat(jdbc.steps).containsExactly(Step.LOOKUP, Step.PENDING, Step.LOCK, Step.CONFIRM);
    assertThat(logs.list)
        .singleElement()
        .satisfies(e -> {
          assertThat(e.getLevel()).isEqualTo(Level.ERROR);
          assertThat(e.getFormattedMessage()).contains(family.toString());
          assertThat(e.getThrowableProxy()).isNull();
        });
    assertNoTokenLogged();
  }

  @Test
  void contentionOnBothWhenTheCheckFailsAnswersBusy() {
    jdbc.failures.put(Step.PENDING, sqlState("55P03"));
    jdbc.failures.put(Step.LOCK, sqlState("55P03"));
    jdbc.failures.put(Step.CONFIRM, new DataAccessResourceFailureException("connection lost"));

    Throwable thrown = org.assertj.core.api.Assertions.catchThrowable(() -> auth.signOut(RAW));

    assertBusy(thrown);
    assertThat(at(Level.ERROR)).singleElement();
    assertNoTokenLogged();
  }

  @Test
  void contentionOnTheRowOnlyNeedsNoCheckWhenTheLockedRevokeLands() {
    jdbc.failures.put(Step.PENDING, sqlState("55P03"));
    jdbc.familySureToEnd = false;

    auth.signOut(RAW);

    assertThat(jdbc.steps)
        .containsExactly(Step.LOOKUP, Step.PENDING, Step.LOCK, Step.REVOKE, Step.CLEAR_PENDING);
    assertThat(logs.list).isEmpty();
  }

  enum Step {
    LOOKUP,
    PENDING,
    LOCK,
    REVOKE,
    CLEAR_PENDING,
    CONFIRM
  }

  /** The token's family is live; each step records itself and throws its queued failure. */
  private final class StubJdbc extends JdbcTemplate {
    final Map<Step, RuntimeException> failures = new EnumMap<>(Step.class);
    final List<Step> steps = new ArrayList<>();
    boolean inTransaction;
    boolean lockTimeoutSet;
    Boolean pendingBounded;
    boolean familySureToEnd = true;

    private void step(Step step) {
      steps.add(step);
      RuntimeException failure = failures.get(step);
      if (failure != null) {
        throw failure;
      }
    }

    @Override
    public <T> List<T> queryForList(String sql, Class<T> type, Object... args) {
      step(Step.LOOKUP);
      return List.of(type.cast(family));
    }

    @Override
    public <T> T queryForObject(String sql, Class<T> type, Object... args) {
      step(Step.CONFIRM);
      return type.cast(familySureToEnd);
    }

    @Override
    public void execute(String sql) {
      if (sql.startsWith("SET LOCAL lock_timeout") && inTransaction) {
        lockTimeoutSet = true;
      }
    }

    @Override
    public void query(String sql, RowCallbackHandler rch, Object... args) {
      step(Step.LOCK);
    }

    @Override
    public int update(String sql, Object... args) {
      if (sql.startsWith("INSERT INTO refresh_pending_revocation")) {
        pendingBounded = inTransaction && lockTimeoutSet;
        step(Step.PENDING);
      } else if (sql.startsWith("UPDATE refresh_token SET revoked_at")) {
        step(Step.REVOKE);
      } else if (sql.startsWith("DELETE FROM refresh_pending_revocation")) {
        step(Step.CLEAR_PENDING);
      } else {
        throw new AssertionError("unexpected update: " + sql);
      }
      return 1;
    }
  }

  /** Tells the stub when a transaction is open, so it can see what runs bounded by its timeout. */
  private final class NoOpTransactions implements PlatformTransactionManager {
    @Override
    public TransactionStatus getTransaction(TransactionDefinition definition) {
      jdbc.inTransaction = true;
      jdbc.lockTimeoutSet = false;
      return new SimpleTransactionStatus();
    }

    @Override
    public void commit(TransactionStatus status) {
      jdbc.inTransaction = false;
    }

    @Override
    public void rollback(TransactionStatus status) {
      jdbc.inTransaction = false;
    }
  }
}
