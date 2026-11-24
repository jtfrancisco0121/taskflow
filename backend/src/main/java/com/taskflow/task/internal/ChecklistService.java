package com.taskflow.task.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.Ids;
import com.taskflow.shared.RankAllocator;
import com.taskflow.shared.RankScopeLock;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.WorkspaceQuery;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Checklists and their items (TASK-2). Every change bumps the task version (AD-11). */
@Service
class ChecklistService {

  record ItemView(UUID id, String text, boolean checked, UUID assigneeId) {}

  record ChecklistView(UUID id, UUID taskId, String name, List<ItemView> items) {}

  private record ChecklistRow(UUID id, UUID workspaceId, UUID taskId, String name) {}

  private record ItemRow(
      UUID id,
      UUID workspaceId,
      UUID checklistId,
      UUID taskId,
      String text,
      boolean checked,
      UUID assigneeId) {}

  private final JdbcTemplate jdbc;
  private final EventRecorder events;
  private final RankScopeLock rankLock;
  private final RankAllocator ranks;
  private final WorkspaceQuery workspaces;

  ChecklistService(
      JdbcTemplate jdbc,
      EventRecorder events,
      RankScopeLock rankLock,
      RankAllocator ranks,
      WorkspaceQuery workspaces) {
    this.jdbc = jdbc;
    this.events = events;
    this.rankLock = rankLock;
    this.ranks = ranks;
    this.workspaces = workspaces;
  }

  @Transactional(readOnly = true)
  List<ChecklistView> list(UUID taskId) {
    List<ChecklistView> out = new ArrayList<>();
    for (ChecklistRow row :
        jdbc.query(
            "SELECT c.id, c.workspace_id, c.task_id, c.name FROM checklist c WHERE c.task_id = ? ORDER BY"
                + " c.rank COLLATE \"C\", c.id",
            (rs, i) ->
                new ChecklistRow(
                    rs.getObject("id", UUID.class),
                    rs.getObject("workspace_id", UUID.class),
                    rs.getObject("task_id", UUID.class),
                    rs.getString("name")),
            taskId)) {
      out.add(view(row));
    }
    return out;
  }

  @Transactional
  ChecklistView create(UUID taskId, String name) {
    UUID workspaceId = workspaceOf(taskId);
    rankLock.lock(RankScopeLock.Owner.TASK, taskId);
    String rank =
        ranks.append(
            new RankAllocator.Scope(
                "checklist", "workspace_id = ? AND task_id = ?", workspaceId, taskId));
    UUID id = Ids.newId();
    jdbc.update(
        "INSERT INTO checklist (id, workspace_id, task_id, name, rank) VALUES (?, ?, ?, ?, ?)",
        id,
        workspaceId,
        taskId,
        cleanName(name),
        rank);
    touch(workspaceId, taskId, "checklist_created", id, null);
    return view(checklist(id));
  }

  @Transactional
  ChecklistView update(UUID id, ObjectNode patch) {
    ChecklistRow row = checklist(id);
    if (patch.has("name")) {
      jdbc.update(
          "UPDATE checklist SET name = ? WHERE id = ?",
          cleanName(patch.path("name").asText(null)),
          id);
    }
    if (patch.has("beforeId") || patch.has("afterId")) {
      rankLock.lock(RankScopeLock.Owner.TASK, row.taskId());
      String rank =
          ranks.place(
              new RankAllocator.Scope(
                  "checklist", "workspace_id = ? AND task_id = ?", row.workspaceId(), row.taskId()),
              id,
              uuidOrNull(patch, "beforeId"),
              uuidOrNull(patch, "afterId"));
      jdbc.update("UPDATE checklist SET rank = ? WHERE id = ?", rank, id);
    }
    touch(row.workspaceId(), row.taskId(), "checklist_updated", id, null);
    return view(checklist(id));
  }

  @Transactional
  void delete(UUID id) {
    ChecklistRow row = checklist(id);
    jdbc.update("DELETE FROM checklist WHERE id = ?", id);
    touch(row.workspaceId(), row.taskId(), "checklist_deleted", id, null);
  }

  @Transactional
  ChecklistView addItem(
      UUID checklistId, String text, UUID assigneeId, UUID beforeId, UUID afterId) {
    ChecklistRow row = checklist(checklistId);
    checkAssignee(row.workspaceId(), assigneeId);
    rankLock.lock(RankScopeLock.Owner.CHECKLIST, checklistId);
    String rank = ranks.place(itemScope(row.workspaceId(), checklistId), null, beforeId, afterId);
    UUID id = Ids.newId();
    jdbc.update(
        "INSERT INTO checklist_item (id, workspace_id, checklist_id, text, assignee_id, rank) VALUES (?,"
            + " ?, ?, ?, ?, ?)",
        id,
        row.workspaceId(),
        checklistId,
        cleanText(text),
        assigneeId,
        rank);
    touch(row.workspaceId(), row.taskId(), "item_added", checklistId, id);
    return view(checklist(checklistId));
  }

  @Transactional
  ChecklistView updateItem(UUID itemId, ObjectNode patch) {
    ItemRow item = item(itemId);
    if (patch.has("text")) {
      jdbc.update(
          "UPDATE checklist_item SET text = ? WHERE id = ?",
          cleanText(patch.path("text").asText(null)),
          itemId);
    }
    if (patch.has("checked")) {
      if (!patch.get("checked").isBoolean()) {
        throw TaskflowException.badRequest(
            "checklist.invalid_checked", "checked must be true or false");
      }
      jdbc.update(
          "UPDATE checklist_item SET checked = ? WHERE id = ?",
          patch.get("checked").asBoolean(),
          itemId);
    }
    if (patch.has("assigneeId")) {
      UUID assignee = uuidOrNull(patch, "assigneeId");
      checkAssignee(item.workspaceId(), assignee);
      jdbc.update("UPDATE checklist_item SET assignee_id = ? WHERE id = ?", assignee, itemId);
    }
    if (patch.has("beforeId") || patch.has("afterId")) {
      rankLock.lock(RankScopeLock.Owner.CHECKLIST, item.checklistId());
      String rank =
          ranks.place(
              itemScope(item.workspaceId(), item.checklistId()),
              itemId,
              uuidOrNull(patch, "beforeId"),
              uuidOrNull(patch, "afterId"));
      jdbc.update("UPDATE checklist_item SET rank = ? WHERE id = ?", rank, itemId);
    }
    touch(item.workspaceId(), item.taskId(), "item_updated", item.checklistId(), itemId);
    return view(checklist(item.checklistId()));
  }

  @Transactional
  void deleteItem(UUID itemId) {
    ItemRow item = item(itemId);
    jdbc.update("DELETE FROM checklist_item WHERE id = ?", itemId);
    touch(item.workspaceId(), item.taskId(), "item_deleted", item.checklistId(), itemId);
  }

  private static RankAllocator.Scope itemScope(UUID workspaceId, UUID checklistId) {
    return new RankAllocator.Scope(
        "checklist_item", "workspace_id = ? AND checklist_id = ?", workspaceId, checklistId);
  }

  /** Bumps the task version and records checklist.changed on the task (AD-7, AD-11). */
  private void touch(UUID workspaceId, UUID taskId, String action, UUID checklistId, UUID itemId) {
    Map<String, Object> bumped =
        jdbc.queryForMap(
            "UPDATE task SET version = version + 1, updated_at = now() WHERE id = ? RETURNING"
                + " version, list_id",
            taskId);
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("version", bumped.get("version"));
    payload.put("listId", bumped.get("list_id").toString());
    payload.put("action", action);
    payload.put("checklistId", checklistId.toString());
    if (itemId != null) {
      payload.put("itemId", itemId.toString());
    }
    events.record(workspaceId, "task", taskId, "checklist.changed", payload);
  }

  private ChecklistView view(ChecklistRow row) {
    List<ItemView> items =
        jdbc.query(
            "SELECT id, text, checked, assignee_id FROM checklist_item WHERE checklist_id = ? ORDER BY"
                + " rank COLLATE \"C\", id",
            (rs, i) ->
                new ItemView(
                    rs.getObject("id", UUID.class),
                    rs.getString("text"),
                    rs.getBoolean("checked"),
                    rs.getObject("assignee_id", UUID.class)),
            row.id());
    return new ChecklistView(row.id(), row.taskId(), row.name(), items);
  }

  private ChecklistRow checklist(UUID id) {
    return jdbc
        .query(
            "SELECT id, workspace_id, task_id, name FROM checklist WHERE id = ?",
            (rs, i) ->
                new ChecklistRow(
                    rs.getObject("id", UUID.class),
                    rs.getObject("workspace_id", UUID.class),
                    rs.getObject("task_id", UUID.class),
                    rs.getString("name")),
            id)
        .stream()
        .findFirst()
        .orElseThrow(
            () -> TaskflowException.notFound("checklist.not_found", "Checklist not found"));
  }

  private ItemRow item(UUID id) {
    return jdbc
        .query(
            "SELECT i.id, i.workspace_id, i.checklist_id, c.task_id, i.text, i.checked, i.assignee_id FROM"
                + " checklist_item i JOIN checklist c ON c.id = i.checklist_id WHERE i.id = ?",
            (rs, i) ->
                new ItemRow(
                    rs.getObject("id", UUID.class),
                    rs.getObject("workspace_id", UUID.class),
                    rs.getObject("checklist_id", UUID.class),
                    rs.getObject("task_id", UUID.class),
                    rs.getString("text"),
                    rs.getBoolean("checked"),
                    rs.getObject("assignee_id", UUID.class)),
            id)
        .stream()
        .findFirst()
        .orElseThrow(
            () -> TaskflowException.notFound("checklist.not_found", "Checklist item not found"));
  }

  private UUID workspaceOf(UUID taskId) {
    return jdbc
        .queryForList(
            "SELECT workspace_id FROM task WHERE id = ? AND deleted_at IS NULL", UUID.class, taskId)
        .stream()
        .findFirst()
        .orElseThrow(() -> TaskflowException.notFound("task.not_found", "Task not found"));
  }

  private void checkAssignee(UUID workspaceId, UUID userId) {
    if (userId != null && !workspaces.membersAmong(workspaceId, Set.of(userId)).contains(userId)) {
      throw TaskflowException.badRequest(
          "checklist.invalid_assignee", "The assignee must be a member of the workspace");
    }
  }

  private static UUID uuidOrNull(ObjectNode patch, String field) {
    JsonNode node = patch.get(field);
    if (node == null || node.isNull()) {
      return null;
    }
    try {
      return UUID.fromString(node.asText());
    } catch (IllegalArgumentException e) {
      throw TaskflowException.badRequest("checklist.invalid_id", field + " must be an id");
    }
  }

  private static String cleanName(String name) {
    if (name == null || name.isBlank() || name.trim().length() > 200) {
      throw TaskflowException.badRequest(
          "checklist.invalid_name", "A checklist name is 1 to 200 characters");
    }
    return name.trim();
  }

  private static String cleanText(String text) {
    if (text == null || text.isBlank() || text.trim().length() > 1000) {
      throw TaskflowException.badRequest(
          "checklist.invalid_text", "An item is 1 to 1000 characters");
    }
    return text.trim();
  }
}
