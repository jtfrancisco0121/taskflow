package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import com.taskflow.notification.internal.WorkersIntegrationTest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.awaitility.Awaitility;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;

@DisplayName("CAP-3 due-date sweep")
@WorkersIntegrationTest
class DueDateSweepIT extends IntegrationTest {

  @Autowired DueDateSweep sweep;

  private record Fx(Ws ws, UUID space, UUID list) {}

  private Fx fx() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Eng");
    return new Fx(ws, space, list(ws.owner(), space, "Backlog"));
  }

  private UUID taskDue(Fx f, Instant due) {
    UUID task = task(f.ws().owner(), f.list(), "T");
    long version = get("/api/v1/tasks/" + task, f.ws().owner().token()).at("/version").asLong();
    assertThat(patchTask(f.ws().owner(), task, version, Map.of("dueDate", due.toString())).status())
        .isEqualTo(200);
    return task;
  }

  private UUID statusId(TestUser user, UUID list, String name) {
    for (var s : get("/api/v1/locations/" + list + "/statuses", user.token()).at("/statuses")) {
      if (s.get("name").asText().equalsIgnoreCase(name)) {
        return UUID.fromString(s.get("id").asText());
      }
    }
    throw new IllegalStateException("no status " + name);
  }

  private long events(UUID task, String type) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM outbox_event WHERE entity_id = ? AND type = ?",
        Long.class,
        task,
        type);
  }

  @Test
  void twoConcurrentSweepsEmitOneEventPerTaskDueDateAndKind() throws Exception {
    Fx f = fx();
    UUID past = taskDue(f, Instant.now().minusSeconds(3600));
    UUID soon = taskDue(f, Instant.now().plusSeconds(7200));
    Thread a = new Thread(sweep::sweep);
    Thread b = new Thread(sweep::sweep);
    a.start();
    b.start();
    a.join();
    b.join();
    assertThat(events(past, "task.due_reached")).isEqualTo(1);
    assertThat(events(past, "task.due_soon")).isZero();
    assertThat(events(soon, "task.due_soon")).isEqualTo(1);
    assertThat(events(soon, "task.due_reached")).isZero();
    sweep.sweep();
    assertThat(events(past, "task.due_reached")).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT actor_type FROM outbox_event WHERE entity_id = ? AND type ="
                    + " 'task.due_reached'",
                String.class,
                past))
        .isEqualTo("AUTOMATION");
  }

  @Test
  void aNewDueDateGetsNewEventsAndClearingGivesNone() {
    Fx f = fx();
    UUID task = taskDue(f, Instant.now().minusSeconds(7200));
    sweep.sweep();
    assertThat(events(task, "task.due_reached")).isEqualTo(1);
    long version = get("/api/v1/tasks/" + task, f.ws().owner().token()).at("/version").asLong();
    patchTask(
        f.ws().owner(),
        task,
        version,
        Map.of("dueDate", Instant.now().minusSeconds(60).toString()));
    sweep.sweep();
    assertThat(events(task, "task.due_reached")).isEqualTo(2);
    version = get("/api/v1/tasks/" + task, f.ws().owner().token()).at("/version").asLong();
    var cleared = new java.util.HashMap<String, Object>();
    cleared.put("dueDate", null);
    patchTask(f.ws().owner(), task, version, cleared);
    sweep.sweep();
    assertThat(events(task, "task.due_reached")).isEqualTo(2);
  }

  @Test
  void finishedAndTrashedTasksGiveNoEvents() {
    Fx f = fx();
    UUID done = taskDue(f, Instant.now().minusSeconds(3600));
    UUID trashed = taskDue(f, Instant.now().minusSeconds(3600));
    UUID doneStatus = statusId(f.ws().owner(), f.list(), "complete");
    long version = get("/api/v1/tasks/" + done, f.ws().owner().token()).at("/version").asLong();
    patchTask(f.ws().owner(), done, version, Map.of("statusId", doneStatus));
    long trashedVersion =
        get("/api/v1/tasks/" + trashed, f.ws().owner().token()).at("/version").asLong();
    assertThat(
            delete(
                    "/api/v1/tasks/" + trashed,
                    f.ws().owner().token(),
                    "If-Match",
                    "\"" + trashedVersion + "\"")
                .status())
        .isEqualTo(204);
    sweep.sweep();
    assertThat(events(done, "task.due_reached")).isZero();
    assertThat(events(trashed, "task.due_reached")).isZero();
  }

  @Test
  void backfillSuppressesTheBacklogButNotAnUpcomingDueReached() throws Exception {
    Fx f = fx();
    UUID soon = taskDue(f, Instant.now().plusSeconds(2));
    UUID past = taskDue(f, Instant.now().minusSeconds(3600));
    jdbc.update("DELETE FROM task_due_signal");
    String sql =
        new String(
            new ClassPathResource("db/migration/V202612030930__task_due_signal.sql")
                .getInputStream()
                .readAllBytes(),
            StandardCharsets.UTF_8);
    for (String statement : sql.substring(sql.indexOf("INSERT INTO")).split(";")) {
      if (statement.contains("INSERT INTO task_due_signal")) {
        jdbc.update(statement.replaceAll("(?m)^--.*$", ""));
      }
    }
    Awaitility.await()
        .atMost(Duration.ofSeconds(5))
        .until(() -> Instant.now().isAfter(Instant.now().minusSeconds(1)));
    Thread.sleep(2500);
    sweep.sweep();
    assertThat(events(past, "task.due_reached")).isZero();
    assertThat(events(past, "task.due_soon")).isZero();
    assertThat(events(soon, "task.due_soon")).isZero();
    assertThat(events(soon, "task.due_reached")).isEqualTo(1);
  }

  @Test
  void aDueDateArrivesRuleRunsOnceForATaskWhoseInstantPassed() {
    Fx f = fx();
    var body =
        Map.of(
            "name", "Overdue",
            "trigger", Map.of("type", "DUE_DATE_ARRIVED"),
            "actions", List.of(Map.of("type", "SET_PRIORITY", "priority", "URGENT")));
    Resp rule =
        post("/api/v1/locations/" + f.space() + "/automations", f.ws().owner().token(), body);
    assertThat(rule.status()).isEqualTo(201);
    UUID task = taskDue(f, Instant.now().minusSeconds(60));
    sweep.sweep();
    Awaitility.await()
        .atMost(Duration.ofSeconds(20))
        .until(() ->
            jdbc.queryForObject(
                    "SELECT count(*) FROM automation_run WHERE rule_id = ? AND task_id = ? AND"
                        + " status = 'SUCCEEDED'",
                    Long.class,
                    rule.uuid("/id"),
                    task)
                == 1L);
    assertThat(get("/api/v1/tasks/" + task, f.ws().owner().token()).text("/priority"))
        .isEqualTo("URGENT");
  }

  @Test
  void manyDueTasksAreSweptInBatchesWithoutOneLongTransaction() {
    Fx f = fx();
    UUID owner = f.ws().owner().id();
    int rows = 1200;
    jdbc.update(
        "INSERT INTO task (id, workspace_id, list_id, status_id, number, title, priority, due_date,"
            + " rank, created_by) SELECT gen_random_uuid(), ?, ?, (SELECT id FROM status WHERE"
            + " location_id = (SELECT location_id FROM status s2 WHERE s2.workspace_id = ? LIMIT 1)"
            + " AND status_group = 'NOT_STARTED' LIMIT 1), 100000 + g, 'bulk ' || g, 'NONE', now() -"
            + " interval '1 hour', 'z' || lpad(g::text, 6, '0'), ? FROM generate_series(1, ?) g",
        f.ws().id(),
        f.list(),
        f.ws().id(),
        owner,
        rows);
    sweep.sweep();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE workspace_id = ? AND type ="
                    + " 'task.due_reached'",
                Long.class,
                f.ws().id()))
        .isEqualTo((long) rows);
  }
}
