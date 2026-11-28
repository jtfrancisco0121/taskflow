package com.taskflow;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * ClickUp 14yq6g334t6 guard: the test Postgres must not negotiate TLS (pgjdbc's default sslmode
 * "prefer" sends an SSLRequest first, which failed with 08P01 on a fresh container), and it must
 * count as started only after a real JDBC connection works, not after the log line alone. Removing
 * either setting from {@link TestcontainersConfiguration} fails this test.
 */
@DisplayName("Testcontainers Postgres: no TLS, connecting wait")
class TestcontainersPostgresGuardTest {

  private final TaskflowPostgresContainer postgres =
      new TestcontainersConfiguration().postgresContainer();

  @Test
  void theJdbcUrlDisablesSsl() {
    assertThat(postgres.urlParameters()).containsEntry("sslmode", "disable");
  }

  @Test
  void theContainerWaitsForARealConnection() {
    assertThat(postgres.waitStrategy()).isInstanceOf(PostgresConnectionWait.class);
  }

  @Test
  void theConnectionWaitStillWaitsForTheReadyLogLineFirst() {
    assertThat(((PostgresConnectionWait) postgres.waitStrategy()).logWait())
        .isInstanceOf(org.testcontainers.containers.wait.strategy.LogMessageWaitStrategy.class);
  }
}
