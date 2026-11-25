package com.taskflow.task.internal;

import com.taskflow.shared.Actor;
import com.taskflow.shared.EventRecorder;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Emits {@code task.due_soon} (24 h before the due instant) and {@code task.due_reached} (at it)
 * once per task and due date (CAP-3, AD-10). The unique key of {@code task_due_signal} makes two
 * sweeps, on one instance or several, produce one event each; every batch of 500 is its own short
 * transaction, repeated until a batch comes back short. No ShedLock (decision 009).
 */
@Component
@ConditionalOnProperty(
    name = "taskflow.workers.enabled",
    havingValue = "true",
    matchIfMissing = true)
class DueDateSweep {

  static final int BATCH = 500;
  private static final Logger log = LoggerFactory.getLogger(DueDateSweep.class);

  private record Due(UUID workspaceId, UUID taskId, Instant dueDate, UUID listId, long version) {}

  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final EventRecorder events;

  DueDateSweep(JdbcTemplate jdbc, TransactionTemplate tx, EventRecorder events) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.events = events;
  }

  @Scheduled(
      fixedDelayString = "${taskflow.due-sweep.interval-ms:60000}",
      initialDelayString = "${taskflow.due-sweep.initial-delay-ms:15000}")
  public void sweep() {
    try {
      drain("DUE_REACHED", "t.due_date <= now()");
      drain("DUE_SOON", "t.due_date > now() AND t.due_date <= now() + interval '24 hours'");
    } catch (RuntimeException e) {
      log.warn("due-date sweep failed, it runs again on the next tick: {}", e.toString());
    }
  }

  private void drain(String kind, String window) {
    int batch;
    do {
      Integer done = tx.execute(status -> emit(kind, window));
      batch = done == null ? 0 : done;
    } while (batch >= BATCH);
  }

  /** One batch: signal rows and their events in the same transaction. Returns rows emitted. */
  private int emit(String kind, String window) {
    List<Due> inserted =
        jdbc.query(
            "WITH cand AS (SELECT t.workspace_id, t.id, t.due_date, t.list_id, t.version FROM task t"
                + " JOIN status s ON s.workspace_id = t.workspace_id AND s.id = t.status_id JOIN"
                + " location l ON l.workspace_id = t.workspace_id AND l.id = t.list_id WHERE"
                + " t.deleted_at IS NULL AND l.deleted_at IS NULL AND t.due_date IS NOT NULL AND "
                + window
                + " AND s.status_group IN ('NOT_STARTED', 'ACTIVE') AND NOT EXISTS (SELECT 1 FROM"
                + " task_due_signal d WHERE d.task_id = t.id AND d.due_date = t.due_date AND d.kind"
                + " = ?) ORDER BY t.due_date, t.id LIMIT "
                + BATCH
                + "), ins AS (INSERT INTO task_due_signal (workspace_id, task_id, due_date, kind)"
                + " SELECT workspace_id, id, due_date, ? FROM cand ON CONFLICT DO NOTHING RETURNING"
                + " task_id, due_date) SELECT c.workspace_id, c.id, c.due_date, c.list_id, c.version"
                + " FROM cand c JOIN ins i ON i.task_id = c.id AND i.due_date = c.due_date",
            (rs, i) ->
                new Due(
                    rs.getObject("workspace_id", UUID.class),
                    rs.getObject("id", UUID.class),
                    rs.getTimestamp("due_date").toInstant(),
                    rs.getObject("list_id", UUID.class),
                    rs.getLong("version")),
            kind,
            kind);
    String type = kind.equals("DUE_SOON") ? "task.due_soon" : "task.due_reached";
    for (Due d : inserted) {
      Map<String, Object> payload = new LinkedHashMap<>();
      payload.put("version", d.version());
      payload.put("listId", d.listId().toString());
      payload.put("dueDate", d.dueDate().toString());
      events.record(d.workspaceId(), "task", d.taskId(), type, payload, Actor.SYSTEM);
    }
    return inserted.size();
  }
}
