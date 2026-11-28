package com.taskflow.task.internal;

import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.Ids;
import com.taskflow.shared.LockContention;
import com.taskflow.shared.LockTimeout;
import com.taskflow.shared.TaskflowException;
import com.taskflow.task.TaskView;
import com.taskflow.workspace.Action;
import com.taskflow.workspace.LocationAccess;
import com.taskflow.workspace.Permissions;
import com.taskflow.workspace.Role;
import com.taskflow.workspace.WorkspaceQuery;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Relationships between tasks (DEP-1..DEP-3): add, remove and list. The only writer of {@code
 * task_dependency}. A write runs in one transaction in this order: the Workspace advisory lock,
 * both task rows {@code FOR UPDATE} in id order, the {@code If-Match} comparison, the cycle check,
 * the limit, the insert or delete, the version bump of both tasks and the events on both ends
 * (AD-2, AD-6). It never retries inside the transaction (the idempotency layer owns it and a
 * deadlock aborts it): a lock wait or deadlock is answered {@code 409 dependency.busy}.
 */
@Service
class DependencyService {

  static final int MAX_PER_TASK = 100;
  private static final Duration LOCK_WAIT = Duration.ofSeconds(5);

  /** What the acting task is, from its own side. {@code BLOCKED_BY} is an alias of WAITING_ON. */
  enum Relation {
    WAITING_ON,
    BLOCKING,
    LINKED;

    static Relation parse(String value) {
      if (value == null || value.isBlank()) {
        throw TaskflowException.badRequest(
            "dependency.invalid_relation", "relation is required: WAITING_ON, BLOCKING or LINKED");
      }
      return switch (value.trim().toUpperCase(Locale.ROOT)) {
        case "WAITING_ON", "BLOCKED_BY" -> WAITING_ON;
        case "BLOCKING", "BLOCKS" -> BLOCKING;
        case "LINKED", "LINKED_TO" -> LINKED;
        default ->
            throw TaskflowException.badRequest(
                "dependency.invalid_relation",
                "relation must be WAITING_ON (alias BLOCKED_BY), BLOCKING or LINKED");
      };
    }

    Relation reverse() {
      return switch (this) {
        case WAITING_ON -> BLOCKING;
        case BLOCKING -> WAITING_ON;
        case LINKED -> LINKED;
      };
    }
  }

  /** The stored form of a relationship: {@code waiter} waits on {@code blocker}, or a link. */
  private record Stored(String type, UUID taskId, UUID dependsOnId) {}

  /** A relationship as the API returns it, from the acting task's side. */
  record DependencyView(UUID id, Relation relation, UUID otherTaskId, Instant createdAt) {}

  /** The result of an add: the relationship and the acting task with its new version. */
  record DependencyAdded(DependencyView dependency, TaskView task) {}

  /** The result of a remove: the acting task's new version. */
  record DependencyRemoved(UUID dependencyId, TaskView task) {}

  /** The other task of a relationship, as a list shows it. */
  record DependencySummary(
      UUID id, String readableId, String title, UUID statusId, UUID listId, boolean finished) {}

  record DependencyItem(UUID dependencyId, DependencySummary task) {}

  /** Relationships the caller cannot see (private location): only counted. */
  record DependencyHidden(int waitingOn, int blocking, int linked) {}

  record DependencyList(
      List<DependencyItem> waitingOn,
      List<DependencyItem> blocking,
      List<DependencyItem> linked,
      DependencyHidden hiddenCount) {}

  private final JdbcTemplate jdbc;
  private final NamedParameterJdbcTemplate named;
  private final TaskRepository repo;
  private final TaskService tasks;
  private final DependencyLock lock;
  private final EventRecorder events;
  private final Permissions permissions;
  private final WorkspaceQuery workspaces;

  DependencyService(
      JdbcTemplate jdbc,
      NamedParameterJdbcTemplate named,
      TaskRepository repo,
      TaskService tasks,
      DependencyLock lock,
      EventRecorder events,
      Permissions permissions,
      WorkspaceQuery workspaces) {
    this.jdbc = jdbc;
    this.named = named;
    this.repo = repo;
    this.tasks = tasks;
    this.lock = lock;
    this.events = events;
    this.permissions = permissions;
    this.workspaces = workspaces;
  }

  // ---- add ----

  @Transactional
  DependencyAdded add(UUID taskId, long expectedVersion, UUID otherId, Relation relation) {
    if (otherId == null) {
      throw TaskflowException.badRequest("dependency.invalid_task", "otherTaskId is required");
    }
    TaskRepository.Row seen = repo.live(taskId);
    if (taskId.equals(otherId)) {
      throw TaskflowException.badRequest("dependency.self", "A task cannot be related to itself");
    }
    TaskRepository.Row otherSeen =
        repo.find(otherId)
            .filter(r -> r.deletedAt() == null && r.workspaceId().equals(seen.workspaceId()))
            .orElseThrow(() -> TaskflowException.notFound("task.not_found", "Task not found"));
    permissions.require(Permissions.TASK, otherSeen.id(), Action.VIEW);
    try {
      lockForWrite(seen.workspaceId(), taskId, otherId);
      TaskRepository.Row task = repo.live(taskId);
      TaskRepository.Row other =
          repo.find(otherId)
              .filter(r -> r.deletedAt() == null)
              .orElseThrow(() -> TaskflowException.notFound("task.not_found", "Task not found"));
      if (task.version() != expectedVersion) {
        throw tasks.conflict(task);
      }
      UUID workspace = task.workspaceId();
      Integer pair =
          jdbc.queryForObject(
              "SELECT count(*) FROM task_dependency WHERE workspace_id = ? AND (task_id, depends_on_id)"
                  + " IN ((?, ?), (?, ?))",
              Integer.class,
              workspace,
              taskId,
              otherId,
              otherId,
              taskId);
      if (pair != null && pair > 0) {
        throw exists();
      }
      Stored stored = store(relation, taskId, otherId);
      if (stored.type().equals("WAITING_ON")) {
        checkCycle(workspace, stored.taskId(), stored.dependsOnId());
      }
      checkLimit(workspace, taskId);
      checkLimit(workspace, otherId);
      UUID id = Ids.newId();
      try {
        jdbc.update(
            "INSERT INTO task_dependency (id, workspace_id, task_id, depends_on_id, type,"
                + " created_by) VALUES (?, ?, CASE WHEN ? = 'LINKED' THEN LEAST(CAST(? AS uuid),"
                + " CAST(? AS uuid)) ELSE CAST(? AS uuid) END, CASE WHEN ? = 'LINKED' THEN"
                + " GREATEST(CAST(? AS uuid), CAST(? AS uuid)) ELSE CAST(? AS uuid) END, ?, ?)",
            id,
            workspace,
            stored.type(),
            stored.taskId(),
            stored.dependsOnId(),
            stored.taskId(),
            stored.type(),
            stored.taskId(),
            stored.dependsOnId(),
            stored.dependsOnId(),
            stored.type(),
            CurrentActor.userId());
      } catch (DuplicateKeyException e) {
        throw exists();
      }
      bump(taskId, otherId);
      TaskRepository.Row taskAfter = repo.live(taskId);
      TaskRepository.Row otherAfter = repo.find(otherId).orElseThrow();
      record(workspace, "task.dependency_added", id, taskAfter, relation, otherId);
      record(workspace, "task.dependency_added", id, otherAfter, relation.reverse(), taskId);
      Instant createdAt =
          jdbc.queryForObject(
              "SELECT created_at FROM task_dependency WHERE id = ?",
              (rs, i) -> rs.getTimestamp(1).toInstant(),
              id);
      return new DependencyAdded(
          new DependencyView(id, relation, otherId, createdAt), repo.viewOf(taskAfter));
    } catch (DataAccessException e) {
      throw contention(e);
    }
  }

  // ---- remove ----

  @Transactional
  DependencyRemoved remove(UUID taskId, long expectedVersion, UUID dependencyId) {
    TaskRepository.Row seen = repo.live(taskId);
    try {
      Map<String, Object> peek = edge(seen.workspaceId(), taskId, dependencyId);
      UUID otherId = other(peek, taskId);
      lockForWrite(seen.workspaceId(), taskId, otherId);
      TaskRepository.Row task = repo.live(taskId);
      if (task.version() != expectedVersion) {
        throw tasks.conflict(task);
      }
      // Re-read under the lock: a concurrent remove may have deleted the row.
      Map<String, Object> row = edge(task.workspaceId(), taskId, dependencyId);
      Relation relation = relationOf(row, taskId);
      jdbc.update("DELETE FROM task_dependency WHERE id = ?", dependencyId);
      bump(taskId, otherId);
      TaskRepository.Row taskAfter = repo.live(taskId);
      TaskRepository.Row otherAfter = repo.find(otherId).orElseThrow();
      record(
          task.workspaceId(),
          "task.dependency_removed",
          dependencyId,
          taskAfter,
          relation,
          otherId);
      record(
          task.workspaceId(),
          "task.dependency_removed",
          dependencyId,
          otherAfter,
          relation.reverse(),
          taskId);
      return new DependencyRemoved(dependencyId, repo.viewOf(taskAfter));
    } catch (DataAccessException e) {
      throw contention(e);
    }
  }

  /** The row, only when it is in this Workspace and touches the path task; else 404 (no IDOR). */
  private Map<String, Object> edge(UUID workspaceId, UUID taskId, UUID dependencyId) {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT id, task_id, depends_on_id, type FROM task_dependency WHERE id = ? AND"
                + " workspace_id = ? AND (task_id = ? OR depends_on_id = ?)",
            dependencyId,
            workspaceId,
            taskId,
            taskId);
    if (rows.isEmpty()) {
      throw TaskflowException.notFound("dependency.not_found", "Relationship not found");
    }
    return rows.get(0);
  }

  private static UUID other(Map<String, Object> row, UUID taskId) {
    UUID a = (UUID) row.get("task_id");
    return a.equals(taskId) ? (UUID) row.get("depends_on_id") : a;
  }

  private static Relation relationOf(Map<String, Object> row, UUID taskId) {
    if ("LINKED".equals(row.get("type"))) {
      return Relation.LINKED;
    }
    return row.get("task_id").equals(taskId) ? Relation.WAITING_ON : Relation.BLOCKING;
  }

  // ---- list ----

  @Transactional(readOnly = true)
  DependencyList list(UUID taskId) {
    TaskRepository.Row task = repo.live(taskId);
    Role role =
        workspaces
            .roleOf(task.workspaceId(), CurrentActor.userId())
            .orElseThrow(() -> TaskflowException.notFound("task.not_found", "Task not found"));
    MapSqlParameterSource params =
        new MapSqlParameterSource(LocationAccess.params(CurrentActor.userId(), role));
    params.addValue("w", task.workspaceId());
    params.addValue("me", taskId);
    List<DependencyItem> waitingOn = new ArrayList<>();
    List<DependencyItem> blocking = new ArrayList<>();
    List<DependencyItem> linked = new ArrayList<>();
    int[] hidden = new int[3];
    named.query(
        "SELECT d.id AS dep_id, d.task_id, d.type, o.id AS other_id, w.key || '-' || o.number AS"
            + " readable_id, o.title, o.status_id, o.list_id, s.status_group IN ('DONE', 'CLOSED') AS"
            + " finished, "
            + LocationAccess.visible("l")
            + " AS visible FROM task_dependency d JOIN task o ON o.workspace_id = d.workspace_id AND"
            + " o.id = CASE WHEN d.task_id = :me THEN d.depends_on_id ELSE d.task_id END JOIN"
            + " workspace w ON w.id = o.workspace_id JOIN location l ON l.workspace_id ="
            + " o.workspace_id AND l.id = o.list_id JOIN status s ON s.id = o.status_id WHERE"
            + " d.workspace_id = :w AND (d.task_id = :me OR d.depends_on_id = :me) AND o.deleted_at"
            + " IS NULL AND l.deleted_at IS NULL ORDER BY d.created_at, d.id",
        params,
        rs -> {
          boolean linkedType = "LINKED".equals(rs.getString("type"));
          int group = linkedType ? 2 : (taskId.equals(rs.getObject("task_id", UUID.class)) ? 0 : 1);
          if (!rs.getBoolean("visible")) {
            hidden[group]++;
            return;
          }
          DependencyItem item =
              new DependencyItem(
                  rs.getObject("dep_id", UUID.class),
                  new DependencySummary(
                      rs.getObject("other_id", UUID.class),
                      rs.getString("readable_id"),
                      rs.getString("title"),
                      rs.getObject("status_id", UUID.class),
                      rs.getObject("list_id", UUID.class),
                      rs.getBoolean("finished")));
          (group == 0 ? waitingOn : group == 1 ? blocking : linked).add(item);
        });
    return new DependencyList(
        waitingOn, blocking, linked, new DependencyHidden(hidden[0], hidden[1], hidden[2]));
  }

  // ---- internals ----

  /** The stored form of a relationship seen from the acting task (AD-1: one place converts). */
  private static Stored store(Relation relation, UUID taskId, UUID otherId) {
    return switch (relation) {
      case WAITING_ON -> new Stored("WAITING_ON", taskId, otherId);
      case BLOCKING -> new Stored("WAITING_ON", otherId, taskId);
      case LINKED -> new Stored("LINKED", taskId, otherId);
    };
  }

  /**
   * The Workspace advisory lock, then both task rows in id order (so a concurrent edit or trash of
   * either task cannot slip between the version check and the bump).
   */
  private void lockForWrite(UUID workspaceId, UUID a, UUID b) {
    LockTimeout.set(jdbc, LOCK_WAIT);
    lock.lock(workspaceId);
    jdbc.query("SELECT id FROM task WHERE id IN (?, ?) ORDER BY id FOR UPDATE", rs -> {}, a, b);
  }

  /**
   * Refuses when the new "waiter waits on blocker" row would close a loop: every task the blocker
   * already waits on, directly or not, trashed ones included, so a restore can never create one.
   * Reachability is a set (UNION), so a dense graph cannot blow up the search.
   */
  private void checkCycle(UUID workspaceId, UUID waiter, UUID blocker) {
    Map<UUID, UUID> prev = new HashMap<>();
    prev.put(blocker, null);
    jdbc.query(
        "WITH RECURSIVE reach(task_id, prev) AS (SELECT CAST(? AS uuid), CAST(NULL AS uuid) UNION"
            + " SELECT d.depends_on_id, d.task_id FROM reach r JOIN task_dependency d ON"
            + " d.workspace_id = ? AND d.task_id = r.task_id AND d.type = 'WAITING_ON') SELECT"
            + " task_id, prev FROM reach",
        rs -> {
          UUID id = rs.getObject("task_id", UUID.class);
          UUID p = rs.getObject("prev", UUID.class);
          if (!prev.containsKey(id)) {
            prev.put(id, p);
          }
        },
        blocker,
        workspaceId);
    if (!prev.containsKey(waiter)) {
      return;
    }
    // waiter -> blocker (the new row) -> ... -> waiter: walk back from the waiter.
    List<UUID> back = new ArrayList<>();
    UUID cursor = waiter;
    int guard = 0;
    while (cursor != null && guard++ < 10_000) {
      back.add(cursor);
      cursor = prev.get(cursor);
    }
    Collections.reverse(back);
    List<UUID> path = new ArrayList<>();
    path.add(waiter);
    path.addAll(back);
    Set<UUID> shown = visibleLive(workspaceId, path);
    List<String> ids = new ArrayList<>();
    for (UUID id : path) {
      ids.add(shown.contains(id) ? id.toString() : null);
    }
    throw TaskflowException.conflict(
            "dependency.cycle", "This relationship would make the tasks wait on each other")
        .with("path", ids);
  }

  private Set<UUID> visibleLive(UUID workspaceId, List<UUID> ids) {
    Role role = workspaces.roleOf(workspaceId, CurrentActor.userId()).orElse(null);
    if (role == null) {
      return Set.of();
    }
    MapSqlParameterSource params =
        new MapSqlParameterSource(LocationAccess.params(CurrentActor.userId(), role));
    params.addValue("w", workspaceId);
    params.addValue("ids", new HashSet<>(ids));
    return new HashSet<>(
        named.queryForList(
            "SELECT t.id FROM task t JOIN location l ON l.workspace_id = t.workspace_id AND l.id ="
                + " t.list_id WHERE t.workspace_id = :w AND t.id IN (:ids) AND t.deleted_at IS NULL"
                + " AND "
                + LocationAccess.visible("l"),
            params,
            UUID.class));
  }

  private void checkLimit(UUID workspaceId, UUID taskId) {
    Integer n =
        jdbc.queryForObject(
            "SELECT count(*) FROM task_dependency WHERE workspace_id = ? AND (task_id = ? OR"
                + " depends_on_id = ?)",
            Integer.class,
            workspaceId,
            taskId,
            taskId);
    if (n != null && n >= MAX_PER_TASK) {
      throw TaskflowException.conflict(
              "dependency.limit", "A task has at most " + MAX_PER_TASK + " relationships")
          .with("taskId", taskId.toString());
    }
  }

  private void bump(UUID a, UUID b) {
    jdbc.update(
        "UPDATE task SET version = version + 1, updated_at = now() WHERE id IN (?, ?)", a, b);
  }

  private void record(
      UUID workspaceId,
      String type,
      UUID dependencyId,
      TaskRepository.Row end,
      Relation relation,
      UUID otherId) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("version", end.version());
    payload.put("listId", end.listId().toString());
    payload.put("dependencyId", dependencyId.toString());
    payload.put("relation", relation.name());
    payload.put("otherTaskId", otherId.toString());
    events.record(workspaceId, "task", end.id(), type, payload);
  }

  private static TaskflowException exists() {
    return TaskflowException.conflict("dependency.exists", "These two tasks are already related");
  }

  /**
   * Lock contention, as the shared {@link LockContention} classifies it (40P01, 40001, 55P03), is
   * 409 dependency.busy; any other data access failure is returned unchanged. The global mapping
   * answers the same contention with 503 request.busy: unifying the status is an open API decision
   * (ClickUp 14yq6g334r6), so this one keeps 409.
   */
  static RuntimeException contention(DataAccessException e) {
    return LockContention.isContention(e) ? busy() : e;
  }

  private static TaskflowException busy() {
    return TaskflowException.conflict(
        "dependency.busy", "The tasks are being changed right now; retry the request");
  }
}
