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
 * ClickUp 14yq6g334r6 slice 2: DependencyService classifies lock contention with the shared
 * LockContention (40P01, 40001, 55P03), like the 503 mapping and sign-out. Its answer stays 409
 * dependency.busy: moving it to 503 request.busy is an API change left to the owner.
 */
@DisplayName("TASK dependency lock contention")
class DependencyServiceContentionTest {

  private static UncategorizedSQLException sqlState(String state) {
    return new UncategorizedSQLException("dep", "SELECT 1", new SQLException("x", state));
  }

  @Test
  void everyLockContentionStateIs409DependencyBusy() {
    for (String state : new String[] {"55P03", "40P01", "40001"}) {
      RuntimeException mapped = DependencyService.contention(sqlState(state));

      assertThat(mapped)
          .as(state)
          .isInstanceOfSatisfying(
              TaskflowException.class,
              e -> {
                assertThat(e.status()).isEqualTo(HttpStatus.CONFLICT);
                assertThat(e.code()).isEqualTo("dependency.busy");
              });
    }
  }

  @Test
  void anyOtherDataAccessFailureIsReturnedUnchanged() {
    DataAccessException other = sqlState("23505");

    assertThat(DependencyService.contention(other)).isSameAs(other);
  }
}
