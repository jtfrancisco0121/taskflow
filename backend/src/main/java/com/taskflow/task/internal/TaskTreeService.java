package com.taskflow.task.internal;

import com.taskflow.field.StatusCatalog;
import com.taskflow.field.StatusGroup;
import com.taskflow.field.StatusInfo;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.Ids;
import com.taskflow.shared.Page;
import com.taskflow.shared.PageCursor;
import com.taskflow.shared.RankAllocator;
import com.taskflow.shared.TaskflowException;
import com.taskflow.task.TaskView;
import com.taskflow.workspace.Action;
import com.taskflow.workspace.LocationAccess;
import com.taskflow.workspace.LocationInfo;
import com.taskflow.workspace.Permissions;
import com.taskflow.workspace.Role;
import com.taskflow.workspace.WorkspaceQuery;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Move, duplicate, trash and restore of tasks and their subtrees (TASK-2, TASK-3, TASK-4). */
@Service
class TaskTreeService {

  static final Duration RETENTION = Duration.ofDays(30);

  record TrashItem(
      TaskView task, Instant deletedAt, UUID trashBatchId, Instant purgeAt, int subtaskCount) {}

  private final TaskRepository repo;
  private final TaskService tasks;
  private final JdbcTemplate jdbc;
  private final NamedParameterJdbcTemplate named;
  private final EventRecorder events;
  private final Permissions permissions;
  private final StatusCatalog statuses;
  private final WorkspaceQuery workspaces;
  private final RankAllocator ranks;

  TaskTreeService(
      TaskRepository repo,
      TaskService tasks,
      JdbcTemplate jdbc,
      NamedParameterJdbcTemplate named,
      EventRecorder events,
      Permissions permissions,
      StatusCatalog statuses,
      WorkspaceQuery workspaces,
      RankAllocator ranks) {
    this.repo = repo;
    this.tasks = tasks;
    this.jdbc = jdbc;
    this.named = named;
    this.events = events;
    this.permissions = permissions;
    this.statuses = statuses;
    this.workspaces = workspaces;
    this.ranks = ranks;
  }

  // ---- move ----

  @Transactional
  TaskView move(
      UUID id,
      long expectedVersion,
      UUID targetListId,
      UUID beforeId,
      UUID afterId,
      UUID statusId) {
    TaskRepository.Row seen = repo.live(id);
    permissions.require(Permissions.LOCATION, targetListId, Action.CREATE);
    LocationInfo target = tasks.requireList(targetListId);
    if (!target.workspaceId().equals(seen.workspaceId())) {
      throw TaskflowException.notFound("location.not_found", "List not found");
    }
    repo.lockLists(seen.listId(), targetListId);
    TaskRepository.Row task = repo.live(id);
    if (task.version() != expectedVersion) {
      throw tasks.conflict(task);
    }
    boolean sameList = task.listId().equals(targetListId);
    UUID newParent = sameList ? task.parentTaskId() : null;
    for (UUID neighbour : new UUID[] {beforeId, afterId}) {
      if (neighbour != null) {
        permissions.require(Permissions.TASK, neighbour, Action.VIEW);
      }
    }
    if (statusId != null && !statuses.isValid(targetListId, statusId)) {
      throw TaskflowException.badRequest(
          "task.invalid_status", "The status is not offered by the target List");
    }
    String rank =
        ranks.place(
            TaskService.siblings(task.workspaceId(), targetListId, newParent),
            id,
            beforeId,
            afterId);
    long newVersion = task.version() + 1;
    if (sameList) {
      guardedUpdate(task, "rank = ?, status_id = COALESCE(?, status_id)", rank, statusId);
      Map<String, Object> changes = new LinkedHashMap<>();
      changes.put("rank", TaskService.change(task.rank(), rank));
      if (statusId != null && !statusId.equals(task.statusId())) {
        changes.put("statusId", TaskService.change(task.statusId(), statusId));
      }
      events.record(
          task.workspaceId(),
          "task",
          id,
          "task.moved",
          Map.of("version", newVersion, "changes", changes));
      return repo.view(id);
    }
    List<TaskRepository.SubRow> subtree = repo.subtree(id, false);
    Map<UUID, UUID> statusMap = new HashMap<>();
    UUID rootStatus =
        statusId != null ? statusId : mapStatus(task.statusId(), targetListId, statusMap);
    guardedUpdate(
        task,
        "list_id = ?, parent_task_id = NULL, rank = ?, status_id = ?",
        targetListId,
        rank,
        rootStatus);
    Map<String, Object> rootChanges = new LinkedHashMap<>();
    rootChanges.put("listId", TaskService.change(task.listId(), targetListId));
    if (!rootStatus.equals(task.statusId())) {
      rootChanges.put("statusId", TaskService.change(task.statusId(), rootStatus));
    }
    if (task.parentTaskId() != null) {
      rootChanges.put("parentTaskId", TaskService.change(task.parentTaskId(), null));
    }
    events.record(
        task.workspaceId(),
        "task",
        id,
        "task.moved",
        Map.of("version", newVersion, "changes", rootChanges));
    for (TaskRepository.SubRow sub : subtree) {
      if (sub.id().equals(id)) {
        continue;
      }
      TaskRepository.Row child = repo.find(sub.id()).orElseThrow();
      UUID childStatus = mapStatus(child.statusId(), targetListId, statusMap);
      jdbc.update(
          "UPDATE task SET list_id = ?, status_id = ?, version = version + 1, updated_at = now() WHERE"
              + " id = ?",
          targetListId,
          childStatus,
          child.id());
      Map<String, Object> changes = new LinkedHashMap<>();
      changes.put("listId", TaskService.change(child.listId(), targetListId));
      if (!childStatus.equals(child.statusId())) {
        changes.put("statusId", TaskService.change(child.statusId(), childStatus));
      }
      events.record(
          child.workspaceId(),
          "task",
          child.id(),
          "task.moved",
          Map.of("version", child.version() + 1, "changes", changes));
    }
    return repo.view(id);
  }

  /** The status a task gets in a List: kept when valid, else the first of its group, else to do. */
  UUID mapStatus(UUID statusId, UUID listId, Map<UUID, UUID> cache) {
    return cache.computeIfAbsent(
        statusId,
        old -> {
          if (statuses.isValid(listId, old)) {
            return old;
          }
          Optional<StatusGroup> group = statuses.find(old).map(StatusInfo::group);
          return group
              .flatMap(g -> statuses.sameGroupFirst(listId, g))
              .or(() -> statuses.firstNotStarted(listId))
              .orElseThrow(() ->
                  TaskflowException.conflict(
                      "task.no_status", "The List has no NOT_STARTED status"));
        });
  }

  private void guardedUpdate(TaskRepository.Row task, String sets, Object... args) {
    List<Object> all = new ArrayList<>(java.util.Arrays.asList(args));
    all.add(task.id());
    all.add(task.version());
    int updated =
        jdbc.update(
            "UPDATE task SET "
                + sets
                + ", version = version + 1, updated_at = now() WHERE id = ? AND version = ? AND"
                + " deleted_at IS NULL",
            all.toArray());
    if (updated == 0) {
      throw tasks.conflict(repo.live(task.id()));
    }
  }

  // ---- duplicate ----

  @Transactional
  TaskView duplicate(UUID id, UUID targetListId) {
    TaskRepository.Row seen = repo.live(id);
    UUID target = targetListId == null ? seen.listId() : targetListId;
    if (!target.equals(seen.listId())) {
      permissions.require(Permissions.LOCATION, target, Action.CREATE);
      LocationInfo list = tasks.requireList(target);
      if (!list.workspaceId().equals(seen.workspaceId())) {
        throw TaskflowException.notFound("location.not_found", "List not found");
      }
    }
    repo.lockLists(seen.listId(), target);
    TaskRepository.Row source = repo.live(id);
    boolean sameList = source.listId().equals(target);
    List<TaskRepository.SubRow> subtree = repo.subtree(id, true);
    Map<UUID, UUID> newIds = new HashMap<>();
    Map<UUID, UUID> statusMap = new HashMap<>();
    UUID rootCopy = null;
    for (TaskRepository.SubRow sub : subtree) {
      TaskRepository.Row row = repo.find(sub.id()).orElseThrow();
      boolean root = sub.id().equals(id);
      UUID copyId = Ids.newId();
      newIds.put(sub.id(), copyId);
      UUID parent =
          root ? (sameList ? source.parentTaskId() : null) : newIds.get(sub.parentTaskId());
      String rank = ranks.append(TaskService.siblings(row.workspaceId(), target, parent));
      UUID status = mapStatus(row.statusId(), target, statusMap);
      long number = repo.nextNumber(row.workspaceId());
      jdbc.update(
          "INSERT INTO task (id, workspace_id, list_id, parent_task_id, status_id, number, title,"
              + " description, priority, start_date, due_date, rank, custom, created_by) SELECT ?,"
              + " workspace_id, ?, ?, ?, ?, ?, description, priority, start_date, due_date, ?, custom,"
              + " ? FROM task WHERE id = ?",
          copyId,
          target,
          parent,
          status,
          number,
          root ? truncate(row.title() + " (copy)") : row.title(),
          rank,
          CurrentActor.userId(),
          row.id());
      jdbc.update(
          "INSERT INTO task_assignee (workspace_id, task_id, user_id) SELECT workspace_id, ?, user_id"
              + " FROM task_assignee WHERE task_id = ?",
          copyId,
          row.id());
      jdbc.update(
          "INSERT INTO task_tag (workspace_id, task_id, tag) SELECT workspace_id, ?, tag FROM task_tag"
              + " WHERE task_id = ?",
          copyId,
          row.id());
      copyChecklists(row.workspaceId(), row.id(), copyId);
      events.record(
          row.workspaceId(),
          "task",
          copyId,
          root ? "task.duplicated" : "task.created",
          Map.of("version", 1, "number", number, "duplicatedFrom", row.id().toString()));
      if (root) {
        rootCopy = copyId;
      }
    }
    return repo.view(rootCopy);
  }

  private void copyChecklists(UUID workspaceId, UUID from, UUID to) {
    List<UUID> checklists =
        jdbc.queryForList(
            "SELECT id FROM checklist WHERE task_id = ? ORDER BY rank COLLATE \"C\", id",
            UUID.class,
            from);
    for (UUID old : checklists) {
      UUID copy = Ids.newId();
      jdbc.update(
          "INSERT INTO checklist (id, workspace_id, task_id, name, rank) SELECT ?, workspace_id, ?, name,"
              + " rank FROM checklist WHERE id = ?",
          copy,
          to,
          old);
      jdbc.update(
          "INSERT INTO checklist_item (id, workspace_id, checklist_id, text, checked, assignee_id, rank)"
              + " SELECT gen_random_uuid(), workspace_id, ?, text, checked, assignee_id, rank FROM"
              + " checklist_item WHERE checklist_id = ?",
          copy,
          old);
    }
  }

  private static String truncate(String title) {
    return title.length() > TaskService.MAX_TITLE
        ? title.substring(0, TaskService.MAX_TITLE)
        : title;
  }

  // ---- trash ----

  @Transactional
  void trash(UUID id, long expectedVersion) {
    TaskRepository.Row seen = repo.live(id);
    repo.lockLists(seen.listId(), null);
    TaskRepository.Row task = repo.live(id);
    if (task.version() != expectedVersion) {
      throw tasks.conflict(task);
    }
    UUID batch = Ids.newId();
    int rootUpdated =
        jdbc.update(
            "UPDATE task SET deleted_at = now(), trash_batch_id = ?, version = version + 1, updated_at ="
                + " now() WHERE id = ? AND version = ? AND deleted_at IS NULL",
            batch,
            id,
            expectedVersion);
    if (rootUpdated == 0) {
      throw tasks.conflict(repo.live(id));
    }
    events.record(
        task.workspaceId(),
        "task",
        id,
        "task.trashed",
        Map.of("version", expectedVersion + 1, "batchId", batch.toString()));
    for (TaskRepository.SubRow sub : repo.subtree(id, true)) {
      if (sub.id().equals(id)) {
        continue;
      }
      TaskRepository.Row child = repo.live(sub.id());
      jdbc.update(
          "UPDATE task SET deleted_at = now(), trash_batch_id = ?, version = version + 1, updated_at ="
              + " now() WHERE id = ?",
          batch,
          child.id());
      events.record(
          child.workspaceId(),
          "task",
          child.id(),
          "task.trashed",
          Map.of("version", child.version() + 1, "batchId", batch.toString()));
    }
  }

  @Transactional
  TaskView restore(UUID id, long expectedVersion) {
    TaskRepository.Row seen = repo.trashed(id);
    repo.lockLists(seen.listId(), null);
    TaskRepository.Row task = repo.trashed(id);
    if (task.version() != expectedVersion) {
      throw tasks.conflict(task);
    }
    LocationInfo list = tasks.requireList(task.listId());
    if (list.archived()) {
      throw TaskflowException.conflict("location.archived", "The List is archived and read-only");
    }
    if (task.parentTaskId() != null) {
      boolean parentTrashed =
          Boolean.TRUE.equals(
              jdbc.queryForObject(
                  "SELECT deleted_at IS NOT NULL FROM task WHERE id = ?",
                  Boolean.class,
                  task.parentTaskId()));
      if (parentTrashed) {
        throw TaskflowException.conflict("task.parent_trashed", "Restore the parent task first");
      }
    }
    List<TaskRepository.Row> batch =
        jdbc.query(
            TaskRepository.SELECT + " WHERE t.trash_batch_id = ? AND t.workspace_id = ?",
            repo.rowMapper(),
            task.trashBatchId(),
            task.workspaceId());
    int rootUpdated =
        jdbc.update(
            "UPDATE task SET deleted_at = NULL, trash_batch_id = NULL, version = version + 1,"
                + " updated_at = now() WHERE id = ? AND version = ? AND deleted_at IS NOT NULL",
            id,
            expectedVersion);
    if (rootUpdated == 0) {
      throw tasks.conflict(repo.find(id).orElseThrow());
    }
    events.record(
        task.workspaceId(), "task", id, "task.restored", Map.of("version", expectedVersion + 1));
    for (TaskRepository.Row row : batch) {
      if (row.id().equals(id)) {
        continue;
      }
      jdbc.update(
          "UPDATE task SET deleted_at = NULL, trash_batch_id = NULL, version = version + 1, updated_at"
              + " = now() WHERE id = ?",
          row.id());
      events.record(
          row.workspaceId(),
          "task",
          row.id(),
          "task.restored",
          Map.of("version", row.version() + 1));
    }
    return repo.view(id);
  }

  /** The workspace trash: roots of trashed batches the caller can see, newest first. */
  @Transactional(readOnly = true)
  Page<TrashItem> trashList(UUID workspaceId, String cursor, Integer requestedLimit) {
    int limit = PageCursor.limit(requestedLimit);
    List<String> after = PageCursor.decode(cursor, 2);
    Role role =
        workspaces
            .roleOf(workspaceId, CurrentActor.userId())
            .orElseThrow(
                () -> TaskflowException.notFound("workspace.not_found", "Workspace not found"));
    MapSqlParameterSource params =
        new MapSqlParameterSource(LocationAccess.params(CurrentActor.userId(), role));
    params.addValue("w", workspaceId);
    params.addValue("n", limit + 1);
    StringBuilder sql =
        new StringBuilder(
            TaskRepository.SELECT
                + " JOIN location l ON l.workspace_id = t.workspace_id AND l.id = t.list_id WHERE"
                + " t.workspace_id = :w AND t.deleted_at IS NOT NULL AND t.trash_batch_id IS NOT NULL"
                + " AND (t.parent_task_id IS NULL OR NOT EXISTS (SELECT 1 FROM task p WHERE p.id ="
                + " t.parent_task_id AND p.trash_batch_id = t.trash_batch_id)) AND "
                + LocationAccess.visible("l"));
    if (after != null) {
      sql.append(
          " AND (t.deleted_at, t.id) < (timestamptz 'epoch' + CAST(:am AS bigint) * interval '1"
              + " microsecond', :aid)");
      params.addValue("am", PageCursor.number(after.get(0)));
      params.addValue("aid", PageCursor.uuid(after.get(1)));
    }
    sql.append(" ORDER BY t.deleted_at DESC, t.id DESC LIMIT :n");
    List<TaskRepository.Row> rows = named.query(sql.toString(), params, repo.rowMapper());
    boolean more = rows.size() > limit;
    List<TaskRepository.Row> pageRows = more ? rows.subList(0, limit) : rows;
    List<TaskView> views = repo.views(pageRows);
    List<TrashItem> items = new ArrayList<>();
    for (int i = 0; i < pageRows.size(); i++) {
      TaskRepository.Row r = pageRows.get(i);
      Integer count =
          jdbc.queryForObject(
              "SELECT count(*) FROM task WHERE trash_batch_id = ? AND id <> ?",
              Integer.class,
              r.trashBatchId(),
              r.id());
      items.add(
          new TrashItem(
              views.get(i),
              r.deletedAt(),
              r.trashBatchId(),
              r.deletedAt().plus(RETENTION),
              count == null ? 0 : count));
    }
    String next = null;
    if (more) {
      TaskRepository.Row last = pageRows.get(pageRows.size() - 1);
      Long micros =
          jdbc.queryForObject(
              "SELECT (EXTRACT(EPOCH FROM deleted_at) * 1000000)::bigint FROM task WHERE id = ?",
              Long.class,
              last.id());
      next = PageCursor.encode(String.valueOf(micros), last.id().toString());
    }
    return new Page<>(items, next);
  }
}
