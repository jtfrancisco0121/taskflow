package com.taskflow;

import java.time.Duration;
import java.util.Map;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.wait.strategy.WaitStrategy;

/**
 * The integration tests' Postgres (ClickUp 14yq6g334t6). The container has no TLS, so connections
 * use {@code sslmode=disable} instead of pgjdbc's default "prefer" (an SSLRequest first, which can
 * fail with 08P01 "setting up the SSL connection"). It counts as started only once a JDBC
 * connection through the mapped port works ({@link PostgresConnectionWait}), after the default log
 * wait.
 */
public class TaskflowPostgresContainer extends PostgreSQLContainer<TaskflowPostgresContainer> {

  public TaskflowPostgresContainer(String image) {
    super(image);
    withUrlParam("sslmode", "disable");
    // PostgreSQLContainer#waitUntilContainerStarted runs only getWaitStrategy(): the default
    // log wait (ready line twice), now followed by the connection probe.
    waitingFor(
        new PostgresConnectionWait(
                getWaitStrategy(), this::getJdbcUrl, this::getUsername, this::getPassword)
            .withStartupTimeout(Duration.ofSeconds(120)));
  }

  /** The parameters every JDBC URL of this container carries (read by the guard test). */
  Map<String, String> urlParameters() {
    return Map.copyOf(urlParameters);
  }

  /** The wait run at start (read by the guard test). */
  WaitStrategy waitStrategy() {
    return getWaitStrategy();
  }
}
