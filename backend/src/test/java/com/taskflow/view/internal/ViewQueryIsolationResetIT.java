package com.taskflow.view.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;

import com.taskflow.task.TaskReader;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 14yq6g334tg: the view query runs in a REPEATABLE READ transaction. The pooled connection it ran
 * on must go back to the pool at READ COMMITTED, or every later request that borrows it (writes
 * included) would run at REPEATABLE READ and could fail with serialization errors.
 */
@DisplayName("VIEW-4 the view query's connection returns to the pool at READ COMMITTED")
class ViewQueryIsolationResetIT extends ViewTestBase {

  /** The spy from {@link com.taskflow.IntegrationTest}. */
  @Autowired TaskReader tasks;

  @Autowired DataSource dataSource;

  @Test
  void theConnectionOfARepeatableReadViewQueryIsBackAtReadCommitted() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Iso");
    UUID list = list(ws.owner(), space, "Board");
    task(ws.owner(), list, "Alpha");

    // Inside the view query's transaction: its connection's backend and its isolation.
    AtomicReference<Integer> pid = new AtomicReference<>();
    AtomicReference<String> inside = new AtomicReference<>();
    doAnswer(
            inv -> {
              pid.set(jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class));
              inside.set(jdbc.queryForObject("SHOW transaction_isolation", String.class));
              return inv.callRealMethod();
            })
        .when(tasks)
        .views(any());

    Map<String, Object> body = new HashMap<>();
    body.put("scope", Map.of("locationId", list));
    body.put("config", Map.of("v", 1, "group", "status"));
    body.put("limit", 50);
    Resp r = post("/api/v1/views/query", ws.owner().token(), body);

    assertThat(r.status()).as(r.raw()).isEqualTo(200);
    assertThat(pid.get()).as("the view query loaded tasks").isNotNull();
    assertThat(inside.get()).isEqualTo("repeatable read");

    // Borrow the idle pooled connections (holding each) until we hold that same backend, then ask
    // it. A background job may have it for a moment: release and try again.
    HikariDataSource pool = dataSource.unwrap(HikariDataSource.class);
    String after = null;
    for (int attempt = 0; attempt < 50 && after == null; attempt++) {
      List<Connection> held = new ArrayList<>();
      try {
        int idle = pool.getHikariPoolMXBean().getIdleConnections();
        for (int i = 0; i < idle && after == null; i++) {
          Connection c = pool.getConnection();
          held.add(c);
          if (pid.get().equals(backendPid(c))) {
            after = isolation(c);
          }
        }
      } finally {
        for (Connection c : held) {
          c.close();
        }
      }
      if (after == null) {
        Thread.sleep(100);
      }
    }
    assertThat(after).as("the view query's pooled connection was found").isNotNull();
    assertThat(after).isEqualTo("read committed");
  }

  private static int backendPid(Connection c) throws SQLException {
    try (Statement s = c.createStatement();
        ResultSet rs = s.executeQuery("SELECT pg_backend_pid()")) {
      rs.next();
      return rs.getInt(1);
    }
  }

  private static String isolation(Connection c) throws SQLException {
    try (Statement s = c.createStatement();
        ResultSet rs = s.executeQuery("SHOW transaction_isolation")) {
      rs.next();
      return rs.getString(1);
    }
  }
}
