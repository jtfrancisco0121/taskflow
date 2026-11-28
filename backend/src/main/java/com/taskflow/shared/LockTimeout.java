package com.taskflow.shared;

import java.time.Duration;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * How long the current transaction waits for a lock before failing with 55P03 ({@link
 * LockContention}). SET LOCAL ends with the transaction, so call it inside one; outside a
 * transaction Postgres ignores it with a warning. The one place that writes the statement (ClickUp
 * 14yq6g334r6).
 */
public final class LockTimeout {

  private LockTimeout() {}

  /**
   * Sets lock_timeout for the current transaction, in whole milliseconds. Zero would mean "wait
   * forever" to Postgres, so a timeout under one millisecond (zero, negative, or a positive one
   * that would render as 0ms) is refused.
   */
  public static void set(JdbcTemplate jdbc, Duration timeout) {
    if (timeout.toMillis() < 1) {
      throw new IllegalArgumentException("lock timeout must be at least 1 ms: " + timeout);
    }
    jdbc.execute("SET LOCAL lock_timeout = '" + timeout.toMillis() + "ms'");
  }
}
