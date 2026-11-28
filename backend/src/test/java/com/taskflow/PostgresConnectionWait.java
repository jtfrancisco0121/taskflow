package com.taskflow;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.function.Supplier;
import org.testcontainers.containers.ContainerLaunchException;
import org.testcontainers.containers.wait.strategy.AbstractWaitStrategy;
import org.testcontainers.containers.wait.strategy.WaitStrategy;

/**
 * Waits for the Postgres "ready" log line (the image's default wait), then until a JDBC connection
 * through the mapped host port runs {@code SELECT 1} (ClickUp 14yq6g334t6). The log line alone does
 * not prove the host port reaches the server: Flyway's first connection then failed with 08P01.
 */
final class PostgresConnectionWait extends AbstractWaitStrategy {

  private static final long RETRY_MILLIS = 100;

  private final WaitStrategy logWait;
  private final Supplier<String> url;
  private final Supplier<String> user;
  private final Supplier<String> password;

  PostgresConnectionWait(
      WaitStrategy logWait,
      Supplier<String> url,
      Supplier<String> user,
      Supplier<String> password) {
    this.logWait = logWait;
    this.url = url;
    this.user = user;
    this.password = password;
  }

  WaitStrategy logWait() {
    return logWait;
  }

  @Override
  protected void waitUntilReady() {
    long deadline = System.nanoTime() + startupTimeout.toNanos();
    logWait.withStartupTimeout(startupTimeout).waitUntilReady(waitStrategyTarget);
    SQLException last = null;
    int attempts = 0;
    while (System.nanoTime() < deadline) {
      attempts++;
      try (Connection connection =
              DriverManager.getConnection(url.get(), user.get(), password.get());
          Statement statement = connection.createStatement()) {
        statement.execute("SELECT 1");
        return;
      } catch (SQLException e) {
        last = e;
      }
      try {
        Thread.sleep(RETRY_MILLIS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new ContainerLaunchException("Interrupted while waiting for Postgres", e);
      }
    }
    throw new ContainerLaunchException(
        "Postgres did not accept a JDBC connection within "
            + startupTimeout
            + " ("
            + attempts
            + " attempts)",
        last);
  }
}
