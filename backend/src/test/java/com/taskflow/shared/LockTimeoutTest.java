package com.taskflow.shared;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * ClickUp 14yq6g334r6 slice 2: the one helper for the transaction's lock wait, replacing the four
 * hand-written SET LOCAL lock_timeout statements.
 */
@DisplayName("Shared transaction lock timeout")
class LockTimeoutTest {

  private final List<String> statements = new ArrayList<>();
  private final JdbcTemplate jdbc =
      new JdbcTemplate() {
        @Override
        public void execute(String sql) {
          statements.add(sql);
        }
      };

  @Test
  void setsTheTransactionLocalLockTimeoutInMilliseconds() {
    LockTimeout.set(jdbc, Duration.ofSeconds(2));
    LockTimeout.set(jdbc, Duration.ofMillis(1500));

    assertThat(statements)
        .containsExactly("SET LOCAL lock_timeout = '2000ms'", "SET LOCAL lock_timeout = '1500ms'");
  }

  @Test
  void refusesAZeroOrNegativeTimeoutWhichPostgresWouldReadAsWaitForever() {
    assertThatThrownBy(() -> LockTimeout.set(jdbc, Duration.ZERO))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> LockTimeout.set(jdbc, Duration.ofSeconds(-1)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(statements).isEmpty();
  }
}
