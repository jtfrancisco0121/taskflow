package com.taskflow.task.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.taskflow.identity.ServiceAccounts;
import com.taskflow.shared.AgentTool;
import com.taskflow.shared.AgentToolArgs;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.TaskflowException;
import com.taskflow.task.Priority;
import com.taskflow.task.TaskView;
import com.taskflow.workspace.Action;
import com.taskflow.workspace.Permissions;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The task tools an agent can call over MCP (MCP-1, MCP-2). Each does what the matching REST
 * endpoint does: the same {@link Permissions} check and action, then the same service method, and
 * returns the same view. Plain-text {@code description} and {@code text} become documents here.
 */
@Configuration
class TaskAgentTools {

  private final TaskService tasks;
  private final TaskTreeService tree;
  private final CommentService comments;
  private final TaskSearchService search;
  private final TaskAgentSearch agentSearch;
  private final Permissions permissions;
  private final ServiceAccounts serviceAccounts;
  private final ObjectMapper mapper;

  TaskAgentTools(
      TaskService tasks,
      TaskTreeService tree,
      CommentService comments,
      TaskSearchService search,
      TaskAgentSearch agentSearch,
      Permissions permissions,
      ServiceAccounts serviceAccounts,
      ObjectMapper mapper) {
    this.tasks = tasks;
    this.tree = tree;
    this.comments = comments;
    this.search = search;
    this.agentSearch = agentSearch;
    this.permissions = permissions;
    this.serviceAccounts = serviceAccounts;
    this.mapper = mapper;
  }

  /** Matches the maxItems of the search_tasks customFields schema. */
  private static final int MAX_CUSTOM_CONDITIONS = 10;

  private static final String TASK_FIELDS =
      """
      "title": {"type": "string", "maxLength": 500},
      "description": {"type": "string", "description": "Plain text, one paragraph per line"},
      "statusId": {"type": "string", "format": "uuid"},
      "priority": {"type": "string", "enum": ["URGENT", "HIGH", "NORMAL", "LOW", "NONE"]},
      "startDate": {"type": "string", "format": "date-time"},
      "dueDate": {"type": "string", "format": "date-time"},
      "assigneeIds": {"type": "array", "items": {"type": "string", "format": "uuid"}},
      "tags": {"type": "array", "items": {"type": "string", "maxLength": 50}},
      "parentTaskId": {"type": "string", "format": "uuid"},
      "customFields": {"type": "object", "additionalProperties": true, "description":
        "Custom field values as {field id or name: value}. A Dropdown or Labels value may be an Option name. null clears a field. See list_custom_fields."}
      """;

  @Bean
  AgentTool searchTasksTool() {
    return AgentTool.of(
        "search_tasks",
        "Search the tasks of your Workspace by words in the title or description, and/or filter them"
            + " on custom field values (see list_custom_fields). Pass query, customFields, or both;"
            + " locationId limits the search to a Space, Folder or List. With a query results are"
            + " ranked by relevance; with only conditions the most recently updated come first."
            + " Operators by type: text contains, not_contains, is_set, is_empty; number eq, neq, gt,"
            + " gte, lt, lte, between, is_set, is_empty; date before, after, on, between, is_set,"
            + " is_empty; dropdown any_of, none_of, is_set, is_empty (values are Option names); labels"
            + " also all_of; checkbox is_checked, is_unchecked; rating eq, gte, lte; progress gte,"
            + " lte, between.",
        """
        {"type": "object", "properties": {
          "query": {"type": "string", "minLength": 1, "maxLength": 200},
          "locationId": {"type": "string", "format": "uuid"},
          "customFields": {"type": "array", "maxItems": 10, "items": {
            "type": "object", "required": ["fieldId", "op"], "properties": {
              "fieldId": {"type": "string", "format": "uuid"},
              "op": {"type": "string"},
              "value": {}
            }}},
          "cursor": {"type": "string", "description": "nextCursor of the previous page"},
          "limit": {"type": "integer", "minimum": 1}
        }, "anyOf": [{"required": ["query"]}, {"required": ["customFields"]}]}
        """,
        args -> {
          UUID workspace = workspaceOfCaller();
          permissions.require(Permissions.WORKSPACE, workspace, Action.VIEW);
          String query = AgentToolArgs.optText(args, "query");
          UUID locationId = AgentToolArgs.optUuid(args, "locationId");
          List<TaskAgentSearch.Cond> conditions = conditions(args);
          boolean hasQuery = query != null && !query.isBlank();
          if (!hasQuery && conditions.isEmpty()) {
            throw AgentToolArgs.invalid("Pass a query or at least one customFields condition");
          }
          if (locationId == null && conditions.isEmpty()) {
            // The plain text search, unchanged (REST /search uses it too).
            return search.search(
                workspace,
                query,
                AgentToolArgs.optText(args, "cursor"),
                AgentToolArgs.optInt(args, "limit"));
          }
          if (locationId != null) {
            permissions.require(Permissions.LOCATION, locationId, Action.VIEW);
          }
          return agentSearch.search(
              workspace,
              locationId,
              query,
              conditions,
              AgentToolArgs.optText(args, "cursor"),
              AgentToolArgs.optInt(args, "limit"));
        });
  }

  private static List<TaskAgentSearch.Cond> conditions(JsonNode args) {
    JsonNode v = args.get("customFields");
    if (v == null || v.isNull()) {
      return List.of();
    }
    if (!v.isArray()) {
      throw AgentToolArgs.invalid("customFields must be an array of {fieldId, op, value}");
    }
    if (v.size() > MAX_CUSTOM_CONDITIONS) {
      throw AgentToolArgs.invalid(
          "customFields takes at most " + MAX_CUSTOM_CONDITIONS + " conditions");
    }
    List<TaskAgentSearch.Cond> out = new ArrayList<>();
    for (JsonNode c : v) {
      out.add(
          new TaskAgentSearch.Cond(
              AgentToolArgs.uuid(c, "fieldId"), AgentToolArgs.text(c, "op"), c.get("value")));
    }
    return out;
  }

  /** The {@code customFields} argument of create_task and update_task, as an object or absent. */
  private static Map<String, JsonNode> customFields(JsonNode args) {
    JsonNode v = args.get("customFields");
    if (v == null || v.isNull()) {
      return null;
    }
    if (!v.isObject()) {
      throw AgentToolArgs.invalid("customFields must be an object of field -> value");
    }
    Map<String, JsonNode> out = new LinkedHashMap<>();
    v.fields().forEachRemaining(e -> out.put(e.getKey(), e.getValue()));
    return out;
  }

  @Bean
  AgentTool getTaskTool() {
    return AgentTool.of(
        "get_task",
        "Read one task by taskId or by readable reference such as TF-12. Its version is what"
            + " update_task, move_task and delete_task expect.",
        """
        {"type": "object", "properties": {
          "taskId": {"type": "string", "format": "uuid"},
          "ref": {"type": "string", "description": "Readable id, for example TF-12"}
        }}
        """,
        args -> {
          UUID id = AgentToolArgs.optUuid(args, "taskId");
          if (id != null) {
            permissions.require(Permissions.TASK, id, Action.VIEW);
            return tasks.get(id);
          }
          String ref = AgentToolArgs.optText(args, "ref");
          if (ref == null || ref.isBlank()) {
            throw AgentToolArgs.invalid("taskId or ref is required");
          }
          UUID workspace = workspaceOfCaller();
          permissions.require(Permissions.WORKSPACE, workspace, Action.VIEW);
          return tasks.byRef(workspace, ref);
        });
  }

  @Bean
  AgentTool createTaskTool() {
    return AgentTool.withIdempotencyKey(createTask());
  }

  private AgentTool createTask() {
    return AgentTool.of(
        "create_task",
        "Create a task in a List. Find the listId with list_locations.",
        "{\"type\": \"object\", \"required\": [\"listId\", \"title\"], \"properties\": {"
            + "\"listId\": {\"type\": \"string\", \"format\": \"uuid\"},"
            + TASK_FIELDS.replace("\n", " ")
            + "}}",
        args -> {
          UUID listId = AgentToolArgs.uuid(args, "listId");
          permissions.require(Permissions.LOCATION, listId, Action.CREATE);
          String title = AgentToolArgs.text(args, "title");
          if (title.length() > 500) {
            throw AgentToolArgs.invalid("title has at most 500 characters");
          }
          JsonNode description = PlainText.toDoc(args.get("description"));
          return tasks.create(
              listId,
              new TaskService.TaskInput(
                  title,
                  description,
                  AgentToolArgs.optUuid(args, "statusId"),
                  priority(args),
                  instant(args, "startDate"),
                  instant(args, "dueDate"),
                  uuids(args, "assigneeIds"),
                  strings(args, "tags"),
                  AgentToolArgs.optUuid(args, "parentTaskId"),
                  customFields(args)));
        });
  }

  @Bean
  AgentTool updateTaskTool() {
    return AgentTool.withIdempotencyKey(updateTask());
  }

  private AgentTool updateTask() {
    return AgentTool.of(
        "update_task",
        "Change fields of a task. version must be the task's current version (from get_task); a"
            + " stale one fails with task.version_conflict and the current task. Absent fields are"
            + " left alone; description null clears it; a customFields value null clears that"
            + " field.",
        "{\"type\": \"object\", \"required\": [\"taskId\", \"version\"], \"properties\": {"
            + "\"taskId\": {\"type\": \"string\", \"format\": \"uuid\"},"
            + "\"version\": {\"type\": \"integer\"},"
            + TASK_FIELDS.replace("\n", " ")
            + "}}",
        args -> {
          UUID id = AgentToolArgs.uuid(args, "taskId");
          permissions.require(Permissions.TASK, id, Action.EDIT);
          Long version = AgentToolArgs.optLong(args, "version");
          if (version == null) {
            throw AgentToolArgs.invalid("version is required");
          }
          ObjectNode patch = mapper.createObjectNode();
          for (String field :
              List.of(
                  "title",
                  "statusId",
                  "priority",
                  "startDate",
                  "dueDate",
                  "assigneeIds",
                  "tags",
                  "parentTaskId",
                  "customFields")) {
            if (args.has(field)) {
              patch.set(field, args.get(field));
            }
          }
          if (args.has("description")) {
            JsonNode doc = PlainText.toDoc(args.get("description"));
            patch.set("description", doc == null ? mapper.nullNode() : doc);
          }
          return tasks.update(id, version, patch);
        });
  }

  @Bean
  AgentTool moveTaskTool() {
    return AgentTool.of(
        "move_task",
        "Move a task to another List, reorder it among neighbours, or change its status by name"
            + " (for example a Board column). version and listId default to the task's current"
            + " ones.",
        """
        {"type": "object", "required": ["taskId"], "properties": {
          "taskId": {"type": "string", "format": "uuid"},
          "version": {"type": "integer"},
          "listId": {"type": "string", "format": "uuid"},
          "beforeId": {"type": "string", "format": "uuid"},
          "afterId": {"type": "string", "format": "uuid"},
          "statusId": {"type": "string", "format": "uuid"},
          "statusName": {"type": "string"},
          "priority": {"type": "string", "enum": ["URGENT", "HIGH", "NORMAL", "LOW", "NONE"]}
        }}
        """,
        args -> {
          UUID id = AgentToolArgs.uuid(args, "taskId");
          permissions.require(Permissions.TASK, id, Action.EDIT);
          UUID listId = AgentToolArgs.optUuid(args, "listId");
          Long version = AgentToolArgs.optLong(args, "version");
          if (listId == null || version == null) {
            TaskView current = tasks.get(id);
            listId = listId == null ? current.listId() : listId;
            version = version == null ? current.version() : version;
          }
          return tree.move(
              id,
              version,
              new TaskTreeService.MoveInput(
                  listId,
                  AgentToolArgs.optUuid(args, "beforeId"),
                  AgentToolArgs.optUuid(args, "afterId"),
                  AgentToolArgs.optUuid(args, "statusId"),
                  AgentToolArgs.optText(args, "statusName"),
                  priority(args),
                  null,
                  null,
                  false));
        });
  }

  @Bean
  AgentTool deleteTaskTool() {
    return AgentTool.of(
        "delete_task",
        "Move a task to the Workspace trash. It stays there for 30 days and a person can restore"
            + " it. version defaults to the task's current one.",
        """
        {"type": "object", "required": ["taskId"], "properties": {
          "taskId": {"type": "string", "format": "uuid"},
          "version": {"type": "integer"}
        }}
        """,
        args -> {
          UUID id = AgentToolArgs.uuid(args, "taskId");
          permissions.require(Permissions.TASK, id, Action.DELETE);
          Long version = AgentToolArgs.optLong(args, "version");
          if (version == null) {
            version = tasks.get(id).version();
          }
          tree.trash(id, version);
          Map<String, Object> out = new LinkedHashMap<>();
          out.put("taskId", id);
          out.put("trashed", true);
          return out;
        });
  }

  @Bean
  AgentTool addCommentTool() {
    return AgentTool.withIdempotencyKey(addComment());
  }

  private AgentTool addComment() {
    return AgentTool.of(
        "add_comment",
        "Add a comment to a task. text is plain text, one paragraph per line.",
        """
        {"type": "object", "required": ["taskId", "text"], "properties": {
          "taskId": {"type": "string", "format": "uuid"},
          "text": {"type": "string", "minLength": 1}
        }}
        """,
        args -> {
          UUID id = AgentToolArgs.uuid(args, "taskId");
          permissions.require(Permissions.TASK, id, Action.COMMENT);
          return comments.create(id, PlainText.toDoc(AgentToolArgs.text(args, "text")));
        });
  }

  private UUID workspaceOfCaller() {
    return serviceAccounts
        .workspaceOf(CurrentActor.userId())
        .orElseThrow(() ->
            TaskflowException.forbidden("auth.forbidden", "Only a service account can do this"));
  }

  private static Priority priority(JsonNode args) {
    String v = AgentToolArgs.optText(args, "priority");
    if (v == null) {
      return null;
    }
    try {
      return Priority.valueOf(v);
    } catch (IllegalArgumentException e) {
      throw AgentToolArgs.invalid("priority must be one of URGENT, HIGH, NORMAL, LOW, NONE");
    }
  }

  private static Instant instant(JsonNode args, String field) {
    String v = AgentToolArgs.optText(args, field);
    try {
      return v == null ? null : Instant.parse(v);
    } catch (DateTimeParseException e) {
      throw AgentToolArgs.invalid(field + " must be an ISO-8601 instant");
    }
  }

  private static List<UUID> uuids(JsonNode args, String field) {
    JsonNode v = args.get(field);
    if (v == null || v.isNull()) {
      return null;
    }
    if (!v.isArray()) {
      throw AgentToolArgs.invalid(field + " must be an array");
    }
    List<UUID> out = new ArrayList<>();
    for (JsonNode n : v) {
      try {
        out.add(UUID.fromString(n.asText()));
      } catch (IllegalArgumentException e) {
        throw AgentToolArgs.invalid(field + " must hold UUIDs");
      }
    }
    return out;
  }

  private static List<String> strings(JsonNode args, String field) {
    JsonNode v = args.get(field);
    if (v == null || v.isNull()) {
      return null;
    }
    if (!v.isArray()) {
      throw AgentToolArgs.invalid(field + " must be an array");
    }
    List<String> out = new ArrayList<>();
    v.forEach(n -> out.add(n.asText()));
    return out;
  }
}
