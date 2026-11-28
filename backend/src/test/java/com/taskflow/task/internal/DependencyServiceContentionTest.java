package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.shared.TaskflowException;
import java.sql.SQLException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.UncategorizedSQLException;

/**
 * DependencyService classifies lock contention with the shared LockContention (40P01, 40001, 55P03)
 * and answers it like the global mapping: 503 request.busy with Retry-After (ClickUp 14yq6g334u1,
 * JT Francisco 2026-11-28 "Unify on 503 later").
 */
@DisplayName("TASK dependency lock contention")
class DependencyServiceContentionTest {

  private static UncategorizedSQLException sqlState(String state) {
    return new UncategorizedSQLException("dep", "SELECT 1", new SQLException("x", state));
  }

  @Test
  void everyLockContentionStateIs503RequestBusyWithRetryAfter() {
    for (String state : new String[] {"55P03", "40P01", "40001"}) {
      RuntimeException mapped = DependencyService.contention(sqlState(state));

      assertThat(mapped)
          .as(state)
          .isInstanceOfSatisfying(
              TaskflowException.class,
              e -> {
                assertThat(e.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
                assertThat(e.code()).isEqualTo("request.busy");
                assertThat(e.headers()).containsEntry("Retry-After", "1");
              });
    }
  }

  @Test
  void anyOtherDataAccessFailureIsReturnedUnchanged() {
    DataAccessException other = sqlState("23505");

    assertThat(DependencyService.contention(other)).isSameAs(other);
  }
}
