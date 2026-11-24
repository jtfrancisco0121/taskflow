package com.taskflow.task.internal;

import com.taskflow.shared.Actor;
import com.taskflow.shared.EventRecorder;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Hard-deletes trash older than 30 days and records task.purged (AD-15). */
@Service
class TaskPurgeService {

  private static final Logger log = LoggerFactory.getLogger(TaskPurgeService.class);

  private final JdbcTemplate jdbc;
  private final EventRecorder events;

  TaskPurgeService(JdbcTemplate jdbc, EventRecorder events) {
    this.jdbc = jdbc;
    this.events = events;
  }

  /** Purges every trashed task whose deletion is older than the retention at {@code now}. */
  @Transactional
  public int purge(Instant now) {
    Timestamp cutoff = Timestamp.from(now.minus(TaskTreeService.RETENTION));
    record Doomed(UUID id, UUID workspaceId) {}
    List<Doomed> doomed =
        jdbc.query(
            "SELECT id, workspace_id FROM task WHERE deleted_at IS NOT NULL AND deleted_at < ?",
            (rs, i) ->
                new Doomed(
                    rs.getObject("id", UUID.class), rs.getObject("workspace_id", UUID.class)),
            cutoff);
    for (Doomed d : doomed) {
      events.record(
          d.workspaceId(),
          "task",
          d.id(),
          "task.purged",
          Map.of("retentionDays", 30),
          Actor.SYSTEM);
    }
    int deleted =
        jdbc.update("DELETE FROM task WHERE deleted_at IS NOT NULL AND deleted_at < ?", cutoff);
    if (deleted > 0) {
      log.info("purged {} trashed tasks older than the retention", deleted);
    }
    return deleted;
  }
}
