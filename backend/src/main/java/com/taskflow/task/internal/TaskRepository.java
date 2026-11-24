package com.taskflow.task.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.shared.TaskflowException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/** JDBC access to the task tables; the only place that knows their column layout. */
@Repository
class TaskRepository {

  /** A task row with its workspace key; assignees and tags are loaded separately. */
  record Row(
      UUID id,
      UUID workspaceId,
      String workspaceKey,
      UUID listId,
      UUID parentTaskId,
      UUID statusId,
      long number,
      String title,
      JsonNode description,
      Priority priority,
      Instant startDate,
      Instant dueDate,
      String rank,
      long version,
      UUID createdBy,
      Instant createdAt,
      Instant updatedAt,
      Instant deletedAt,
      UUID trashBatchId) {}

  static final String SELECT =
      "SELECT t.id, t.workspace_id, w.key AS workspace_key, t.list_id, t.parent_task_id, t.status_id,"
          + " t.number, t.title, t.description::text AS description, t.priority, t.start_date,"
          + " t.due_date, t.rank, t.version, t.created_by, t.created_at, t.updated_at, t.deleted_at,"
          + " t.trash_batch_id FROM task t JOIN workspace w ON w.id = t.workspace_id";

  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;
  private final RowMapper<Row> rowMapper = this::mapRow;

  TaskRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.mapper = mapper;
  }

  RowMapper<Row> rowMapper() {
    return rowMapper;
  }

  Optional<Row> find(UUID id) {
    return jdbc.query(SELECT + " WHERE t.id = ?", rowMapper, id).stream().findFirst();
  }

  /** A live task, or 404. */
  Row live(UUID id) {
    return find(id)
        .filter(r -> r.deletedAt() == null)
        .orElseThrow(() -> TaskflowException.notFound("task.not_found", "Task not found"));
  }

  /** A task in the trash, or 404. */
  Row trashed(UUID id) {
    return find(id)
        .filter(r -> r.deletedAt() != null)
        .orElseThrow(() -> TaskflowException.notFound("task.not_found", "Task not found"));
  }

  TaskView view(UUID id) {
    return views(List.of(live(id))).get(0);
  }

  TaskView viewOf(Row row) {
    return views(List.of(row)).get(0);
  }

  List<TaskView> views(Collection<Row> rows) {
    if (rows.isEmpty()) {
      return List.of();
    }
    List<UUID> ids = rows.stream().map(Row::id).toList();
    String marks = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
    Map<UUID, List<UUID>> assignees = new HashMap<>();
    jdbc.query(
        "SELECT task_id, user_id FROM task_assignee WHERE task_id IN ("
            + marks
            + ") ORDER BY user_id",
        rs -> {
          assignees
              .computeIfAbsent(rs.getObject("task_id", UUID.class), k -> new ArrayList<>())
              .add(rs.getObject("user_id", UUID.class));
        },
        ids.toArray());
    Map<UUID, List<String>> tags = new HashMap<>();
    jdbc.query(
        "SELECT task_id, tag FROM task_tag WHERE task_id IN (" + marks + ") ORDER BY tag",
        rs -> {
          tags.computeIfAbsent(rs.getObject("task_id", UUID.class), k -> new ArrayList<>())
              .add(rs.getString("tag"));
        },
        ids.toArray());
    List<TaskView> out = new ArrayList<>(rows.size());
    for (Row r : rows) {
      out.add(
          new TaskView(
              r.id(),
              r.workspaceId(),
              r.listId(),
              r.parentTaskId(),
              r.statusId(),
              r.number(),
              r.workspaceKey() + "-" + r.number(),
              r.title(),
              r.description(),
              r.priority(),
              r.startDate(),
              r.dueDate(),
              assignees.getOrDefault(r.id(), List.of()),
              tags.getOrDefault(r.id(), List.of()),
              r.version(),
              r.createdBy(),
              r.createdAt(),
              r.updatedAt()));
    }
    return out;
  }

  /** A task of a subtree with its depth below the root, ordered parents first. */
  record SubRow(UUID id, UUID parentTaskId, int depth) {}

  /**
   * The root and every descendant, parents first then by rank. The CYCLE clause is a second line of
   * defence: a corrupt parent loop ends the recursion instead of looping forever (AD-15).
   */
  List<SubRow> subtree(UUID rootId, boolean liveOnly) {
    return jdbc.query(
        "WITH RECURSIVE sub AS (SELECT id, parent_task_id, rank, 0 AS depth FROM task WHERE id = ?"
            + " UNION ALL SELECT c.id, c.parent_task_id, c.rank, sub.depth + 1 FROM task c JOIN sub ON"
            + " c.parent_task_id = sub.id"
            + (liveOnly ? " WHERE c.deleted_at IS NULL" : "")
            + ") CYCLE id SET is_cycle USING cycle_path SELECT id, parent_task_id, depth FROM sub WHERE"
            + " NOT is_cycle ORDER BY depth, rank COLLATE \"C\", id",
        (rs, i) ->
            new SubRow(
                rs.getObject("id", UUID.class),
                rs.getObject("parent_task_id", UUID.class),
                rs.getInt("depth")),
        rootId);
  }

  /** True when {@code candidate} is {@code rootId} or one of its descendants. */
  boolean inSubtree(UUID rootId, UUID candidate) {
    return subtree(rootId, false).stream().anyMatch(r -> r.id().equals(candidate));
  }

  /** Locks the List rows in id order, so crossed moves cannot deadlock (AD-15). */
  void lockLists(UUID a, UUID b) {
    List<UUID> ids = new ArrayList<>();
    ids.add(a);
    if (b != null && !b.equals(a)) {
      ids.add(b);
    }
    ids.stream()
        .sorted()
        .forEach(id -> jdbc.query("SELECT 1 FROM location WHERE id = ? FOR UPDATE", rs -> {}, id));
  }

  /** The next readable number of the workspace; atomic under parallel creates (AD-14). */
  long nextNumber(UUID workspaceId) {
    Long number =
        jdbc.queryForObject(
            "INSERT INTO task_number_counter (workspace_id, next_number) VALUES (?, 2) ON CONFLICT"
                + " (workspace_id) DO UPDATE SET next_number = task_number_counter.next_number + 1"
                + " RETURNING next_number - 1",
            Long.class,
            workspaceId);
    return number;
  }

  void replaceAssignees(UUID workspaceId, UUID taskId, Collection<UUID> userIds) {
    jdbc.update("DELETE FROM task_assignee WHERE task_id = ?", taskId);
    for (UUID user : userIds) {
      jdbc.update(
          "INSERT INTO task_assignee (workspace_id, task_id, user_id) VALUES (?, ?, ?)",
          workspaceId,
          taskId,
          user);
    }
  }

  void replaceTags(UUID workspaceId, UUID taskId, Collection<String> tags) {
    jdbc.update("DELETE FROM task_tag WHERE task_id = ?", taskId);
    for (String tag : tags) {
      jdbc.update(
          "INSERT INTO task_tag (workspace_id, task_id, tag) VALUES (?, ?, ?)",
          workspaceId,
          taskId,
          tag);
    }
  }

  String json(JsonNode node) {
    try {
      return node == null || node.isNull() ? null : mapper.writeValueAsString(node);
    } catch (JsonProcessingException e) {
      throw new IllegalArgumentException(e);
    }
  }

  private Row mapRow(ResultSet rs, int i) throws SQLException {
    String description = rs.getString("description");
    JsonNode doc;
    try {
      doc = description == null ? null : mapper.readTree(description);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
    return new Row(
        rs.getObject("id", UUID.class),
        rs.getObject("workspace_id", UUID.class),
        rs.getString("workspace_key"),
        rs.getObject("list_id", UUID.class),
        rs.getObject("parent_task_id", UUID.class),
        rs.getObject("status_id", UUID.class),
        rs.getLong("number"),
        rs.getString("title"),
        doc,
        Priority.valueOf(rs.getString("priority")),
        instant(rs, "start_date"),
        instant(rs, "due_date"),
        rs.getString("rank"),
        rs.getLong("version"),
        rs.getObject("created_by", UUID.class),
        instant(rs, "created_at"),
        instant(rs, "updated_at"),
        instant(rs, "deleted_at"),
        rs.getObject("trash_batch_id", UUID.class));
  }

  private static Instant instant(ResultSet rs, String column) throws SQLException {
    java.sql.Timestamp ts = rs.getTimestamp(column);
    return ts == null ? null : ts.toInstant();
  }
}
