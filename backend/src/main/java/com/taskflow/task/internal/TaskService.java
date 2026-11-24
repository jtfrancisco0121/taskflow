package com.taskflow.task.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.taskflow.field.FieldCatalog;
import com.taskflow.field.FieldInfo;
import com.taskflow.field.StatusCatalog;
import com.taskflow.field.StatusGroup;
import com.taskflow.field.ValidatedValues;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.Ids;
import com.taskflow.shared.Page;
import com.taskflow.shared.PageCursor;
import com.taskflow.shared.RankAllocator;
import com.taskflow.shared.RankScopeLock;
import com.taskflow.shared.TaskflowException;
import com.taskflow.task.Priority;
import com.taskflow.task.TaskView;
import com.taskflow.workspace.Action;
import com.taskflow.workspace.LocationAccess;
import com.taskflow.workspace.LocationInfo;
import com.taskflow.workspace.LocationTree;
import com.taskflow.workspace.LocationType;
import com.taskflow.workspace.Permissions;
import com.taskflow.workspace.Role;
import com.taskflow.workspace.WorkspaceQuery;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Create, edit, read and list tasks with optimistic locking (TASK-1, TASK-5, TASK-6). */
@Service
class TaskService {

  static final int MAX_TITLE = 500;
  static final int MAX_TAGS = 50;
  private static final Pattern REF = Pattern.compile("^([A-Za-z]{2,6})-(\\d+)$");

  /** Fields of a create request. */
  record TaskInput(
      String title,
      JsonNode description,
      UUID statusId,
      Priority priority,
      Instant startDate,
      Instant dueDate,
      List<UUID> assigneeIds,
      List<String> tags,
      UUID parentTaskId,
      Map<String, JsonNode> customFields) {}

  /** Longest text of a custom field value in an activity snapshot. */
  static final int SNAPSHOT_TEXT = 200;

  private final TaskRepository repo;
  private final JdbcTemplate jdbc;
  private final NamedParameterJdbcTemplate named;
  private final EventRecorder events;
  private final Permissions permissions;
  private final LocationTree tree;
  private final StatusCatalog statuses;
  private final FieldCatalog fields;
  private final WorkspaceQuery workspaces;
  private final RankScopeLock rankLock;
  private final RankAllocator ranks;
  private final BlockerTransitions blockers;

  TaskService(
      TaskRepository repo,
      JdbcTemplate jdbc,
      NamedParameterJdbcTemplate named,
      EventRecorder events,
      Permissions permissions,
      LocationTree tree,
      StatusCatalog statuses,
      FieldCatalog fields,
      WorkspaceQuery workspaces,
      RankScopeLock rankLock,
      RankAllocator ranks,
      BlockerTransitions blockers) {
    this.blockers = blockers;
    this.repo = repo;
    this.jdbc = jdbc;
    this.named = named;
    this.events = events;
    this.permissions = permissions;
    this.tree = tree;
    this.statuses = statuses;
    this.fields = fields;
    this.workspaces = workspaces;
    this.rankLock = rankLock;
    this.ranks = ranks;
  }

  @Transactional
  TaskView create(UUID listId, TaskInput in) {
    LocationInfo list = requireList(listId);
    String title = cleanTitle(in.title());
    RichText.validate(in.description(), "task.invalid_description");
    checkDates(in.startDate(), in.dueDate());
    Priority priority = in.priority() == null ? Priority.NONE : in.priority();
    List<String> tags = cleanTags(in.tags());
    List<UUID> assignees = checkAssignees(list.workspaceId(), in.assigneeIds());
    ValidatedValues custom = fields.validate(listId, in.customFields());
    UUID parentId = in.parentTaskId();
    if (parentId != null) {
      permissions.require(Permissions.TASK, parentId, Action.VIEW);
      TaskRepository.Row parent = repo.live(parentId);
      if (!parent.listId().equals(listId)) {
        throw TaskflowException.badRequest(
            "task.parent_other_list", "A subtask lives in the same List as its parent");
      }
    }
    UUID statusId = in.statusId();
    if (statusId == null) {
      statusId =
          statuses
              .firstNotStarted(listId)
              .orElseThrow(() ->
                  TaskflowException.conflict(
                      "task.no_status", "The List has no NOT_STARTED status"));
    } else if (!statuses.isValid(listId, statusId)) {
      throw TaskflowException.badRequest(
          "task.invalid_status", "The status is not offered by this List");
    }
    rankLock.lock(RankScopeLock.Owner.LOCATION, listId);
    String rank = ranks.append(siblings(list.workspaceId(), listId, parentId));
    long number = repo.nextNumber(list.workspaceId());
    UUID id = Ids.newId();
    jdbc.update(
        "INSERT INTO task (id, workspace_id, list_id, parent_task_id, status_id, number, title,"
            + " description, priority, start_date, due_date, rank, created_by, custom) VALUES (?, ?,"
            + " ?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?, ?, ?, ?, CAST(? AS jsonb))",
        id,
        list.workspaceId(),
        listId,
        parentId,
        statusId,
        number,
        title,
        repo.json(in.description()),
        priority.name(),
        ts(in.startDate()),
        ts(in.dueDate()),
        rank,
        CurrentActor.userId(),
        customJson(custom));
    repo.replaceAssignees(list.workspaceId(), id, assignees);
    repo.replaceTags(list.workspaceId(), id, tags);
    Map<String, Object> changes = new LinkedHashMap<>();
    changes.put("title", change(null, title));
    changes.put("statusId", change(null, statusId));
    changes.put("priority", change(null, priority));
    if (!assignees.isEmpty()) {
      changes.put("assigneeIds", change(null, assignees));
    }
    if (!tags.isEmpty()) {
      changes.put("tags", change(null, tags));
    }
    if (!custom.set().isEmpty()) {
      changes.put(
          "customFields",
          customChanges(
              custom, com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode()));
    }
    events.record(
        list.workspaceId(),
        "task",
        id,
        "task.created",
        Map.of("version", 1, "listId", listId.toString(), "number", number, "changes", changes));
    return repo.view(id);
  }

  @Transactional(readOnly = true)
  TaskView get(UUID id) {
    return repo.view(id);
  }

  /** Applies a merge patch under optimistic locking (AD-11). */
  @Transactional
  TaskView update(UUID id, long expectedVersion, ObjectNode patch) {
    TaskRepository.Row current = repo.live(id);
    if (patch.has("parentTaskId")) {
      // Re-parenting serialises on the List row, then re-reads inside the lock (decision 002 item
      // 6).
      repo.lockLists(current.listId(), null);
      current = repo.live(id);
    }
    if (current.version() != expectedVersion) {
      throw conflict(current);
    }
    Map<String, Object> changes = new LinkedHashMap<>();
    List<String> sets = new ArrayList<>();
    List<Object> args = new ArrayList<>();

    if (patch.has("title")) {
      String title = cleanTitle(text(patch, "title"));
      if (!title.equals(current.title())) {
        sets.add("title = ?");
        args.add(title);
        changes.put("title", change(current.title(), title));
      }
    }
    if (patch.has("description")) {
      JsonNode doc = patch.get("description");
      RichText.validate(doc, "task.invalid_description");
      JsonNode next = doc.isNull() ? null : doc;
      if (!Objects.equals(current.description(), next)) {
        sets.add("description = CAST(? AS jsonb)");
        args.add(repo.json(next));
        changes.put("description", change("(changed)", "(changed)"));
      }
    }
    if (patch.has("priority")) {
      Priority next = priority(patch.get("priority"));
      if (next != current.priority()) {
        sets.add("priority = ?");
        args.add(next.name());
        changes.put("priority", change(current.priority(), next));
      }
    }
    Instant start = patch.has("startDate") ? date(patch.get("startDate")) : current.startDate();
    Instant due = patch.has("dueDate") ? date(patch.get("dueDate")) : current.dueDate();
    if (patch.has("startDate") || patch.has("dueDate")) {
      checkDates(start, due);
      if (patch.has("startDate") && !Objects.equals(start, current.startDate())) {
        sets.add("start_date = ?");
        args.add(ts(start));
        changes.put("startDate", change(current.startDate(), start));
      }
      if (patch.has("dueDate") && !Objects.equals(due, current.dueDate())) {
        sets.add("due_date = ?");
        args.add(ts(due));
        changes.put("dueDate", change(current.dueDate(), due));
      }
    }
    if (patch.has("parentTaskId")) {
      JsonNode node = patch.get("parentTaskId");
      UUID next = node.isNull() ? null : uuid(node, "task.invalid_parent");
      if (!Objects.equals(next, current.parentTaskId())) {
        if (next != null) {
          if (next.equals(id) || repo.inSubtree(id, next)) {
            throw TaskflowException.conflict(
                "task.parent_cycle", "A task cannot become a subtask of its own subtree");
          }
          permissions.require(Permissions.TASK, next, Action.VIEW);
          if (!repo.live(next).listId().equals(current.listId())) {
            throw TaskflowException.badRequest(
                "task.parent_other_list", "A subtask lives in the same List as its parent");
          }
        }
        sets.add("parent_task_id = ?");
        args.add(next);
        sets.add("rank = ?");
        args.add(ranks.append(siblings(current.workspaceId(), current.listId(), next)));
        changes.put("parentTaskId", change(current.parentTaskId(), next));
      }
    }
    boolean statusOnly = true;
    UUID statusTo = null;
    if (patch.has("statusId")) {
      UUID next = uuid(patch.get("statusId"), "task.invalid_status");
      if (!statuses.isValid(current.listId(), next)) {
        throw TaskflowException.badRequest(
            "task.invalid_status", "The status is not offered by this List");
      }
      if (!next.equals(current.statusId())) {
        sets.add("status_id = ?");
        args.add(next);
        statusTo = next;
        changes.put("statusId", change(current.statusId(), next));
      }
    }
    List<UUID> assigneesAfter = null;
    if (patch.has("assigneeIds")) {
      List<UUID> next = checkAssignees(current.workspaceId(), uuids(patch.get("assigneeIds")));
      List<UUID> before = repo.viewOf(current).assigneeIds();
      if (!new LinkedHashSet<>(before).equals(new LinkedHashSet<>(next))) {
        assigneesAfter = next;
        changes.put("assigneeIds", change(before, next));
      }
    }
    List<String> tagsAfter = null;
    if (patch.has("tags")) {
      List<String> next = cleanTags(strings(patch.get("tags")));
      List<String> before = repo.viewOf(current).tags();
      if (!new LinkedHashSet<>(before).equals(new LinkedHashSet<>(next))) {
        tagsAfter = next;
        changes.put("tags", change(before, next));
      }
    }
    // AD-2: custom field values are a key-level merge in the same versioned UPDATE, never a
    // replace.
    if (patch.has("customFields")) {
      JsonNode node = patch.get("customFields");
      if (!node.isObject()) {
        throw TaskflowException.badRequest(
            "task.invalid_custom_fields", "customFields must be an object of field -> value");
      }
      Map<String, JsonNode> requested = new LinkedHashMap<>();
      node.fields().forEachRemaining(e -> requested.put(e.getKey(), e.getValue()));
      ValidatedValues custom = fields.validate(current.listId(), requested);
      ValidatedValues effectiveChange = onlyChanges(custom, current.custom());
      if (!effectiveChange.isEmpty()) {
        changes.put("customFields", customChanges(effectiveChange, current.custom()));
        if (!effectiveChange.cleared().isEmpty()) {
          sets.add("custom = (custom - CAST(? AS text[])) || CAST(? AS jsonb)");
          args.add(
              effectiveChange.cleared().stream()
                  .map(UUID::toString)
                  .collect(java.util.stream.Collectors.joining(",", "{", "}")));
        } else {
          sets.add("custom = custom || CAST(? AS jsonb)");
        }
        args.add(setJson(effectiveChange));
      }
    }
    for (String key : changes.keySet()) {
      statusOnly &= key.equals("statusId");
    }
    if (changes.isEmpty()) {
      return repo.viewOf(current);
    }
    sets.add("version = version + 1");
    sets.add("updated_at = now()");
    args.add(id);
    args.add(expectedVersion);
    BlockerTransitions.Snapshot blockerBefore =
        changes.containsKey("statusId")
            ? blockers.snapshot(current.workspaceId(), List.of(id))
            : null;
    int updated =
        jdbc.update(
            "UPDATE task SET "
                + String.join(", ", sets)
                + " WHERE id = ? AND version = ? AND deleted_at IS NULL",
            args.toArray());
    if (updated == 0) {
      throw conflict(repo.live(id));
    }
    if (assigneesAfter != null) {
      repo.replaceAssignees(current.workspaceId(), id, assigneesAfter);
    }
    if (tagsAfter != null) {
      repo.replaceTags(current.workspaceId(), id, tagsAfter);
    }
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("version", expectedVersion + 1);
    payload.put("listId", current.listId().toString());
    payload.put("changes", changes);
    if (blockerBefore != null) {
      if (current.blockerCount() > 0 && finishes(current.statusId(), statusTo)) {
        payload.put("completedWhileBlocked", true);
      }
      blockers.record(blockerBefore, BlockerTransitions.Cause.STATUS);
    }
    events.record(
        current.workspaceId(),
        "task",
        id,
        statusOnly ? "task.status_changed" : "task.updated",
        payload);
    return repo.view(id);
  }

  @Transactional(readOnly = true)
  TaskView byRef(UUID workspaceId, String ref) {
    Matcher m = REF.matcher(ref);
    String key = workspaces.keyOf(workspaceId).orElseThrow(() -> notFound());
    if (!m.matches() || !m.group(1).equalsIgnoreCase(key)) {
      throw notFound();
    }
    UUID id =
        jdbc
            .queryForList(
                "SELECT id FROM task WHERE workspace_id = ? AND number = ? AND deleted_at IS NULL",
                UUID.class,
                workspaceId,
                Long.parseLong(m.group(2)))
            .stream()
            .findFirst()
            .orElseThrow(TaskService::notFound);
    permissions.require(Permissions.TASK, id, Action.VIEW);
    return repo.view(id);
  }

  /** Tasks of a location subtree or of a workspace, keyset paged by id (AD-19). */
  @Transactional(readOnly = true)
  Page<TaskView> list(
      UUID locationId,
      UUID workspaceId,
      boolean includeArchived,
      String cursor,
      Integer requestedLimit) {
    if ((locationId == null) == (workspaceId == null)) {
      throw TaskflowException.badRequest(
          "task.scope_required", "Pass exactly one of locationId and workspaceId");
    }
    int limit = PageCursor.limit(requestedLimit);
    List<String> after = PageCursor.decode(cursor, 1);
    UUID workspace;
    String path = null;
    if (locationId != null) {
      permissions.require(Permissions.LOCATION, locationId, Action.VIEW);
      LocationInfo location = tree.find(locationId).orElseThrow(TaskService::notFound);
      workspace = location.workspaceId();
      path = location.path();
    } else {
      permissions.require(Permissions.WORKSPACE, workspaceId, Action.VIEW);
      workspace = workspaceId;
    }
    Role role =
        workspaces.roleOf(workspace, CurrentActor.userId()).orElseThrow(TaskService::notFound);
    MapSqlParameterSource params =
        new MapSqlParameterSource(LocationAccess.params(CurrentActor.userId(), role));
    params.addValue("w", workspace);
    params.addValue("inc", includeArchived);
    params.addValue("n", limit + 1);
    StringBuilder sql =
        new StringBuilder(
            TaskRepository.SELECT
                + " JOIN location l ON l.workspace_id = t.workspace_id AND l.id = t.list_id WHERE"
                + " t.workspace_id = :w AND t.deleted_at IS NULL AND (:inc OR l.archived_at IS NULL)"
                + " AND "
                + LocationAccess.visible("l"));
    if (path != null) {
      sql.append(" AND l.path <@ CAST(:path AS ltree)");
      params.addValue("path", path);
    }
    if (after != null) {
      sql.append(" AND t.id > :after");
      params.addValue("after", com.taskflow.shared.PageCursor.uuid(after.get(0)));
    }
    sql.append(" ORDER BY t.id LIMIT :n");
    List<TaskRepository.Row> rows = named.query(sql.toString(), params, repo.rowMapper());
    boolean more = rows.size() > limit;
    List<TaskRepository.Row> pageRows = more ? rows.subList(0, limit) : rows;
    return new Page<>(
        repo.views(pageRows),
        more ? PageCursor.encode(pageRows.get(pageRows.size() - 1).id().toString()) : null);
  }

  // ---- helpers shared with the other task services ----

  /** True when the status change takes an unfinished task into DONE or CLOSED. */
  boolean finishes(UUID from, UUID to) {
    return !finished(from) && finished(to);
  }

  private boolean finished(UUID statusId) {
    return statuses
        .find(statusId)
        .map(s -> s.group() == StatusGroup.DONE || s.group() == StatusGroup.CLOSED)
        .orElse(false);
  }

  LocationInfo requireList(UUID listId) {
    LocationInfo list =
        tree.find(listId)
            .filter(l -> !l.deleted())
            .orElseThrow(() -> TaskflowException.notFound("location.not_found", "List not found"));
    if (list.type() != LocationType.LIST) {
      throw TaskflowException.badRequest("task.not_a_list", "Tasks live in Lists");
    }
    return list;
  }

  static RankAllocator.Scope siblings(UUID workspaceId, UUID listId, UUID parentTaskId) {
    return parentTaskId == null
        ? new RankAllocator.Scope(
            "task",
            "workspace_id = ? AND list_id = ? AND parent_task_id IS NULL AND deleted_at IS NULL",
            workspaceId,
            listId)
        : new RankAllocator.Scope(
            "task",
            "workspace_id = ? AND list_id = ? AND parent_task_id = ? AND deleted_at IS NULL",
            workspaceId,
            listId,
            parentTaskId);
  }

  TaskflowException conflict(TaskRepository.Row current) {
    return TaskflowException.conflict(
            "task.version_conflict", "The task was changed by someone else; reload and retry")
        .with("current", repo.viewOf(current))
        .with("version", current.version());
  }

  /** The values that differ from what is stored; a no-op value bumps no version (AD-2). */
  private static ValidatedValues onlyChanges(ValidatedValues validated, JsonNode stored) {
    Map<UUID, JsonNode> set = new LinkedHashMap<>();
    java.util.Set<UUID> cleared = new java.util.HashSet<>();
    Map<UUID, FieldInfo> used = new LinkedHashMap<>();
    validated
        .set()
        .forEach((id, value) -> {
          if (!value.equals(stored.get(id.toString()))) {
            set.put(id, value);
            used.put(id, validated.fields().get(id));
          }
        });
    for (UUID id : validated.cleared()) {
      if (stored.has(id.toString())) {
        cleared.add(id);
        used.put(id, validated.fields().get(id));
      }
    }
    return new ValidatedValues(set, cleared, used);
  }

  /**
   * {@code changes.customFields} (AD-7): per field {@code from, to} (omitted for LONG_TEXT, whose
   * value is read from the task) and display snapshots {@code field, fromText, toText}, the texts
   * cut to 200 characters so one request cannot publish events of hundreds of KB.
   */
  private Map<String, Object> customChanges(ValidatedValues v, JsonNode stored) {
    Map<String, Object> out = new LinkedHashMap<>();
    for (FieldInfo f : v.fields().values()) {
      JsonNode before = stored.get(f.id().toString());
      JsonNode after = v.set().get(f.id());
      Map<String, Object> entry = new LinkedHashMap<>();
      if (f.type() != com.taskflow.field.FieldType.LONG_TEXT) {
        entry.put("from", before);
        entry.put("to", after);
      }
      entry.put("field", f.name());
      entry.put("fromText", cut(fields.display(f, before)));
      entry.put("toText", cut(fields.display(f, after)));
      out.put(f.id().toString(), entry);
    }
    return out;
  }

  private static String cut(String text) {
    return text.length() <= SNAPSHOT_TEXT ? text : text.substring(0, SNAPSHOT_TEXT - 1) + "…";
  }

  private String customJson(ValidatedValues v) {
    return setJson(v);
  }

  private String setJson(ValidatedValues v) {
    com.fasterxml.jackson.databind.node.ObjectNode object =
        com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
    v.set().forEach((id, value) -> object.set(id.toString(), value));
    return object.toString();
  }

  static Map<String, Object> change(Object from, Object to) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("from", jsonable(from));
    m.put("to", jsonable(to));
    return m;
  }

  private static Object jsonable(Object value) {
    if (value == null) {
      return null;
    }
    if (value instanceof Enum<?> e) {
      return e.name();
    }
    if (value instanceof List<?> list) {
      return list.stream().map(TaskService::jsonable).toList();
    }
    return value instanceof Number || value instanceof Boolean ? value : value.toString();
  }

  static Timestamp ts(Instant instant) {
    return instant == null ? null : Timestamp.from(instant);
  }

  private static TaskflowException notFound() {
    return TaskflowException.notFound("task.not_found", "Task not found");
  }

  private static String cleanTitle(String title) {
    if (title == null || title.isBlank()) {
      throw TaskflowException.badRequest("task.invalid_title", "A task needs a title");
    }
    String trimmed = title.trim();
    if (trimmed.length() > MAX_TITLE) {
      throw TaskflowException.badRequest(
          "task.invalid_title", "A title has at most 500 characters");
    }
    return trimmed;
  }

  private static void checkDates(Instant start, Instant due) {
    if (start != null && due != null && start.isAfter(due)) {
      throw TaskflowException.badRequest(
          "task.invalid_dates", "The start date must not be after the due date");
    }
  }

  static List<String> cleanTags(List<String> tags) {
    if (tags == null) {
      return List.of();
    }
    Set<String> clean = new LinkedHashSet<>();
    for (String tag : tags) {
      String t = tag == null ? "" : tag.trim().toLowerCase(Locale.ROOT);
      if (t.isEmpty() || t.length() > 50) {
        throw TaskflowException.badRequest("task.invalid_tag", "Tags are 1 to 50 characters");
      }
      clean.add(t);
    }
    if (clean.size() > MAX_TAGS) {
      throw TaskflowException.badRequest("task.invalid_tag", "A task has at most 50 tags");
    }
    return new ArrayList<>(clean);
  }

  List<UUID> checkAssignees(UUID workspaceId, List<UUID> ids) {
    if (ids == null || ids.isEmpty()) {
      return List.of();
    }
    List<UUID> distinct = new ArrayList<>(new LinkedHashSet<>(ids));
    Set<UUID> members = workspaces.membersAmong(workspaceId, distinct);
    if (members.size() != distinct.size()) {
      throw TaskflowException.badRequest(
          "task.invalid_assignee", "Assignees must be members of the workspace");
    }
    return distinct;
  }

  private static String text(ObjectNode patch, String field) {
    JsonNode node = patch.get(field);
    if (node == null || !node.isTextual()) {
      throw TaskflowException.badRequest("task.invalid_" + field, field + " must be a string");
    }
    return node.asText();
  }

  private static Priority priority(JsonNode node) {
    try {
      if (node == null || !node.isTextual()) {
        throw new IllegalArgumentException();
      }
      return Priority.valueOf(node.asText());
    } catch (IllegalArgumentException e) {
      throw TaskflowException.badRequest(
          "task.invalid_priority", "Priority is one of URGENT, HIGH, NORMAL, LOW, NONE");
    }
  }

  private static Instant date(JsonNode node) {
    if (node == null || node.isNull()) {
      return null;
    }
    try {
      return Instant.parse(node.asText());
    } catch (DateTimeParseException e) {
      throw TaskflowException.badRequest("task.invalid_dates", "Dates are ISO-8601 instants");
    }
  }

  private static UUID uuid(JsonNode node, String code) {
    try {
      return UUID.fromString(node.asText());
    } catch (IllegalArgumentException e) {
      throw TaskflowException.badRequest(code, "Expected an id");
    }
  }

  private static List<UUID> uuids(JsonNode node) {
    if (node == null || node.isNull()) {
      return List.of();
    }
    if (!node.isArray()) {
      throw TaskflowException.badRequest("task.invalid_assignee", "assigneeIds must be an array");
    }
    List<UUID> out = new ArrayList<>();
    node.forEach(n -> out.add(uuid(n, "task.invalid_assignee")));
    return out;
  }

  private static List<String> strings(JsonNode node) {
    if (node == null || node.isNull()) {
      return List.of();
    }
    if (!node.isArray()) {
      throw TaskflowException.badRequest("task.invalid_tag", "tags must be an array");
    }
    List<String> out = new ArrayList<>();
    node.forEach(n -> out.add(n.asText()));
    return out;
  }
}
