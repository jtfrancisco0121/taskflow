package com.taskflow.task.internal;

import com.taskflow.field.StatusGroup;
import com.taskflow.shared.EventRecorder;
import com.taskflow.task.BlockedSql;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The one choke point for blocker transitions (AD-5, CAP-6). "Unfinished" (not trashed, List not
 * deleted, status group NOT_STARTED or ACTIVE) comes from {@link BlockedSql#unfinished}; any code
 * that writes {@code task.status_id} or {@code task.deleted_at} calls {@link #snapshot} before the
 * write and {@link #record} after it. For each task whose state flipped, every live task that waits
 * on it gets {@code task.blocker_resolved} or {@code task.blocker_reopened} in the caller's
 * transaction. The dependent's version is not bumped.
 */
@Component
class BlockerTransitions {

  /** Why a task flipped: its status changed, or it was trashed or restored. */
  enum Cause {
    STATUS("completed", "reopened"),
    TRASH("trashed", "restored");

    final String resolved;
    final String reopened;

    Cause(String resolved, String reopened) {
      this.resolved = resolved;
      this.reopened = reopened;
    }
  }

  /** Whether each task was unfinished before the write. */
  record Snapshot(UUID workspaceId, Map<UUID, Boolean> unfinished) {
    boolean isEmpty() {
      return unfinished.isEmpty();
    }
  }

  private final NamedParameterJdbcTemplate named;
  private final JdbcTemplate jdbc;
  private final EventRecorder events;

  BlockerTransitions(NamedParameterJdbcTemplate named, JdbcTemplate jdbc, EventRecorder events) {
    this.named = named;
    this.jdbc = jdbc;
    this.events = events;
  }

  /** Reads the unfinished state of the tasks; call before the write. */
  Snapshot snapshot(UUID workspaceId, Collection<UUID> taskIds) {
    return new Snapshot(workspaceId, unfinished(taskIds));
  }

  /** Records the events for every task of the snapshot whose state differs now. */
  @Transactional(propagation = Propagation.MANDATORY)
  void record(Snapshot before, Cause cause) {
    if (before.isEmpty()) {
      return;
    }
    Map<UUID, Boolean> after = unfinished(before.unfinished().keySet());
    Map<UUID, Boolean> flipped = new LinkedHashMap<>();
    before
        .unfinished()
        .forEach((id, was) -> {
          Boolean is = after.get(id);
          if (is != null && !is.equals(was)) {
            flipped.put(id, is);
          }
        });
    // Tasks trashed or restored together are not told about each other.
    Set<UUID> skip = cause == Cause.TRASH ? new HashSet<>(before.unfinished().keySet()) : Set.of();
    emit(before.workspaceId(), flipped, cause, skip);
  }

  /**
   * A status set edit changed the group of kept statuses: the tasks holding them flip without their
   * own row changing, so there is no snapshot; the old group is carried by the caller.
   */
  @Transactional(propagation = Propagation.MANDATORY)
  void recordGroupChange(
      UUID workspaceId, Collection<UUID> listIds, Map<UUID, StatusGroup> oldGroups) {
    if (listIds.isEmpty() || oldGroups.isEmpty()) {
      return;
    }
    MapSqlParameterSource params = new MapSqlParameterSource();
    params.addValue("w", workspaceId);
    params.addValue("lists", listIds);
    params.addValue("statuses", oldGroups.keySet());
    Map<UUID, Boolean> flipped = new LinkedHashMap<>();
    named.query(
        "SELECT t.id, t.status_id, "
            + BlockedSql.unfinished("t")
            + " AS now_unfinished FROM task t WHERE t.workspace_id = :w AND t.list_id IN (:lists)"
            + " AND t.status_id IN (:statuses) AND t.deleted_at IS NULL",
        params,
        rs -> {
          StatusGroup old = oldGroups.get(rs.getObject("status_id", UUID.class));
          boolean was = old == StatusGroup.NOT_STARTED || old == StatusGroup.ACTIVE;
          boolean is = rs.getBoolean("now_unfinished");
          if (was != is) {
            flipped.put(rs.getObject("id", UUID.class), is);
          }
        });
    emit(workspaceId, flipped, Cause.STATUS, Set.of());
  }

  private Map<UUID, Boolean> unfinished(Collection<UUID> ids) {
    Map<UUID, Boolean> out = new LinkedHashMap<>();
    if (ids.isEmpty()) {
      return out;
    }
    named.query(
        "SELECT t.id, "
            + BlockedSql.unfinished("t")
            + " AS unfinished FROM task t WHERE t.id IN"
            + " (:ids)",
        new MapSqlParameterSource("ids", ids),
        rs -> {
          out.put(rs.getObject("id", UUID.class), rs.getBoolean("unfinished"));
        });
    return out;
  }

  private void emit(UUID workspaceId, Map<UUID, Boolean> flipped, Cause cause, Set<UUID> skip) {
    for (Map.Entry<UUID, Boolean> flip : flipped.entrySet()) {
      UUID blocker = flip.getKey();
      boolean nowUnfinished = flip.getValue();
      List<Map<String, Object>> dependents =
          jdbc.queryForList(
              "SELECT t.id, t.list_id, t.version, "
                  + BlockedSql.blocked("t")
                  + " AS still_blocked FROM task_dependency d JOIN task t ON t.workspace_id ="
                  + " d.workspace_id AND t.id = d.task_id JOIN location l ON l.id = t.list_id WHERE"
                  + " d.workspace_id = ? AND d.depends_on_id = ? AND d.type = 'WAITING_ON' AND"
                  + " t.deleted_at IS NULL AND l.deleted_at IS NULL ORDER BY t.id",
              workspaceId,
              blocker);
      for (Map<String, Object> dependent : dependents) {
        UUID id = (UUID) dependent.get("id");
        if (skip.contains(id)) {
          continue;
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("version", dependent.get("version"));
        payload.put("listId", dependent.get("list_id").toString());
        payload.put("blockerId", blocker.toString());
        if (nowUnfinished) {
          payload.put("reason", cause.reopened);
          events.record(workspaceId, "task", id, "task.blocker_reopened", payload);
        } else {
          payload.put("reason", cause.resolved);
          payload.put("stillBlocked", dependent.get("still_blocked"));
          events.record(workspaceId, "task", id, "task.blocker_resolved", payload);
        }
      }
    }
  }
}
