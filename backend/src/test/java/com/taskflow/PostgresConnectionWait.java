package com.taskflow;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Properties;
import java.util.concurrent.TimeUnit;
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
  private static final long MAX_ATTEMPT_SECONDS = 5;

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
    // The log wait has its own startup timeout; the JDBC phase gets a full one after it, so a slow
    // log
    // wait never leaves it without an attempt (review r1 minor 3).
    logWait.withStartupTimeout(startupTimeout).waitUntilReady(waitStrategyTarget);
    long deadline = System.nanoTime() + startupTimeout.toNanos();
    SQLException last = null;
    int attempts = 0;
    do {
      attempts++;
      try (Connection connection = DriverManager.getConnection(url.get(), attempt(deadline));
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
    } while (System.nanoTime() < deadline);
    throw new ContainerLaunchException(
        "Postgres did not accept a JDBC connection within "
            + startupTimeout
            + " ("
            + attempts
            + " attempts)",
        last);
  }

  /**
   * One attempt's connection settings. pgjdbc waits forever by default for the login and socket
   * reads (loginTimeout and socketTimeout 0), so a port that accepts and never answers would hang
   * the wait past its deadline (review r1 M4): each attempt is bounded by the time left, 1 to 5 s.
   */
  Properties attempt(long deadlineNanos) {
    long left = TimeUnit.NANOSECONDS.toSeconds(deadlineNanos - System.nanoTime());
    String seconds = String.valueOf(Math.max(1, Math.min(MAX_ATTEMPT_SECONDS, left)));
    Properties properties = new Properties();
    properties.setProperty("user", user.get());
    properties.setProperty("password", password.get());
    properties.setProperty("loginTimeout", seconds);
    properties.setProperty("connectTimeout", seconds);
    properties.setProperty("socketTimeout", seconds);
    return properties;
  }
}
