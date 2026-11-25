package com.taskflow.task.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.identity.ApiKeyDirectory;
import com.taskflow.identity.AutomationAuthors;
import com.taskflow.identity.UserDirectory;
import com.taskflow.identity.UserInfo;
import com.taskflow.shared.ActivityItem;
import com.taskflow.shared.ActivityQuery;
import com.taskflow.shared.ActorType;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.Ids;
import com.taskflow.shared.Page;
import com.taskflow.shared.PageCursor;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.WorkspaceQuery;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Comments with mentions, and the per-task activity log (CMT-1, CMT-2). */
@Service
class CommentService {

  record CommentView(
      UUID id,
      UUID taskId,
      UUID authorId,
      String authorName,
      JsonNode body,
      List<UUID> mentionIds,
      Instant createdAt,
      Instant editedAt,
      boolean authorIsAutomation) {}

  record ActivityView(
      UUID id,
      String type,
      ActorType actorType,
      UUID actorId,
      String actorName,
      UUID actorKeyId,
      String actorKeyName,
      JsonNode payload,
      Instant createdAt,
      UUID automationRuleId,
      String automationRuleName) {}

  private record Row(
      UUID id,
      UUID workspaceId,
      UUID taskId,
      UUID authorId,
      JsonNode body,
      Instant createdAt,
      Instant editedAt) {}

  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;
  private final EventRecorder events;
  private final WorkspaceQuery workspaces;
  private final UserDirectory users;
  private final ActivityQuery activity;
  private final ApiKeyDirectory apiKeys;
  private final AuthorResolver authors;
  private final AutomationAuthors automationAuthors;

  CommentService(
      JdbcTemplate jdbc,
      ObjectMapper mapper,
      EventRecorder events,
      WorkspaceQuery workspaces,
      UserDirectory users,
      ActivityQuery activity,
      ApiKeyDirectory apiKeys,
      AuthorResolver authors,
      AutomationAuthors automationAuthors) {
    this.authors = authors;
    this.automationAuthors = automationAuthors;
    this.jdbc = jdbc;
    this.mapper = mapper;
    this.events = events;
    this.workspaces = workspaces;
    this.users = users;
    this.activity = activity;
    this.apiKeys = apiKeys;
  }

  @Transactional(readOnly = true)
  Page<CommentView> list(UUID taskId, String cursor, Integer requestedLimit) {
    int limit = PageCursor.limit(requestedLimit);
    List<String> after = PageCursor.decode(cursor, 1);
    List<Row> rows =
        jdbc.query(
            "SELECT id, workspace_id, task_id, author_id, body::text AS body, created_at, edited_at FROM"
                + " comment WHERE task_id = ? AND deleted_at IS NULL"
                + (after == null ? "" : " AND id > ?")
                + " ORDER BY id LIMIT ?",
            (rs, i) -> row(rs),
            after == null
                ? new Object[] {taskId, limit + 1}
                : new Object[] {taskId, PageCursor.uuid(after.get(0)), limit + 1});
    Page<Row> page = PageCursor.page(rows, limit, r -> PageCursor.encode(r.id().toString()));
    return new Page<>(views(page.items()), page.nextCursor());
  }

  @Transactional
  CommentView create(UUID taskId, JsonNode body) {
    UUID workspaceId =
        jdbc.queryForObject("SELECT workspace_id FROM task WHERE id = ?", UUID.class, taskId);
    RichText.validate(body, "comment.invalid_body");
    if (body == null || body.isNull()) {
      throw TaskflowException.badRequest("comment.invalid_body", "A comment needs a body");
    }
    Set<UUID> mentions = checkedMentions(workspaceId, body);
    UUID id = Ids.newId();
    jdbc.update(
        "INSERT INTO comment (id, workspace_id, task_id, author_id, body) VALUES (?, ?, ?, ?,"
            + " CAST(? AS jsonb))",
        id,
        workspaceId,
        taskId,
        authors.authorOf(workspaceId),
        json(body));
    syncMentions(workspaceId, id, mentions);
    events.record(
        workspaceId,
        "task",
        taskId,
        "comment.created",
        withTask(
            taskId,
            "commentId",
            id.toString(),
            "mentions",
            mentions.stream().map(UUID::toString).toList()));
    return views(List.of(load(id))).get(0);
  }

  @Transactional
  CommentView edit(UUID commentId, JsonNode body) {
    Row row = ownLive(commentId);
    RichText.validate(body, "comment.invalid_body");
    if (body == null || body.isNull()) {
      throw TaskflowException.badRequest("comment.invalid_body", "A comment needs a body");
    }
    Set<UUID> mentions = checkedMentions(row.workspaceId(), body);
    jdbc.update(
        "UPDATE comment SET body = CAST(? AS jsonb), edited_at = now() WHERE id = ?",
        json(body),
        commentId);
    syncMentions(row.workspaceId(), commentId, mentions);
    events.record(
        row.workspaceId(),
        "task",
        row.taskId(),
        "comment.edited",
        withTask(
            row.taskId(),
            "commentId",
            commentId.toString(),
            "mentions",
            mentions.stream().map(UUID::toString).toList()));
    return views(List.of(load(commentId))).get(0);
  }

  @Transactional
  void delete(UUID commentId) {
    Row row = ownLive(commentId);
    jdbc.update("UPDATE comment SET deleted_at = now() WHERE id = ?", commentId);
    events.record(
        row.workspaceId(),
        "task",
        row.taskId(),
        "comment.deleted",
        withTask(row.taskId(), "commentId", commentId.toString()));
  }

  /** A comment event is recorded on the task, so it carries the task's version and List (AD-12). */
  private Map<String, Object> withTask(UUID taskId, Object... extra) {
    Map<String, Object> m = new java.util.LinkedHashMap<>();
    jdbc.query(
        "SELECT version, list_id FROM task WHERE id = ?",
        rs -> {
          m.put("version", rs.getLong("version"));
          m.put("listId", rs.getObject("list_id", UUID.class).toString());
        },
        taskId);
    for (int i = 0; i + 1 < extra.length; i += 2) {
      m.put((String) extra[i], extra[i + 1]);
    }
    return m;
  }

  @Transactional(readOnly = true)
  Page<ActivityView> activity(UUID taskId, String cursor, Integer limit) {
    UUID workspaceId =
        jdbc.queryForObject("SELECT workspace_id FROM task WHERE id = ?", UUID.class, taskId);
    Page<ActivityItem> page = activity.forEntity(workspaceId, "task", taskId, cursor, limit);
    // Users and service accounts both have an app_user row, so one lookup names them.
    Map<UUID, UserInfo> names =
        users.byIds(
            page.items().stream()
                .filter(i -> i.actorType() != ActorType.AUTOMATION)
                .map(ActivityItem::actorId)
                .distinct()
                .toList());
    Map<UUID, String> keyNames =
        apiKeys.namesByIds(
            page.items().stream()
                .filter(i -> i.actorType() == ActorType.SERVICE_ACCOUNT)
                .map(ActivityItem::actorKeyId)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList());
    List<ActivityView> items = new ArrayList<>();
    for (ActivityItem i : page.items()) {
      UserInfo u = i.actorType() == ActorType.AUTOMATION ? null : names.get(i.actorId());
      UUID ruleId = null;
      String ruleName = null;
      String actorName;
      if (i.actorType() == ActorType.AUTOMATION) {
        // A run names its rule in the payload (AD-5); an AUTOMATION actor without one is a system
        // entry such as a due-date event, not a rule.
        JsonNode automation = i.payload() == null ? null : i.payload().path("automation");
        ruleName =
            automation != null && automation.hasNonNull("ruleName")
                ? automation.get("ruleName").asText()
                : null;
        if (ruleName != null) {
          try {
            ruleId = UUID.fromString(automation.path("ruleId").asText());
          } catch (IllegalArgumentException e) {
            ruleId = null;
          }
        }
        actorName = ruleName != null ? ruleName : "Taskflow";
      } else {
        actorName =
            u == null
                ? (i.actorType() == ActorType.USER ? null : i.actorType().name())
                : u.displayName();
      }
      items.add(
          new ActivityView(
              i.id(),
              i.type(),
              i.actorType(),
              i.actorId(),
              actorName,
              i.actorKeyId(),
              i.actorKeyId() == null ? null : keyNames.get(i.actorKeyId()),
              i.payload(),
              i.createdAt(),
              ruleId,
              ruleName));
    }
    return new Page<>(items, page.nextCursor());
  }

  /** The author's own, live comment: anyone else gets 403 even with edit rights elsewhere. */
  private Row ownLive(UUID commentId) {
    Row row = load(commentId);
    boolean deleted =
        Boolean.TRUE.equals(
            jdbc.queryForObject(
                "SELECT deleted_at IS NOT NULL FROM comment WHERE id = ?",
                Boolean.class,
                commentId));
    if (deleted) {
      throw TaskflowException.notFound("comment.not_found", "Comment not found");
    }
    if (!row.authorId().equals(CurrentActor.userId())) {
      throw TaskflowException.forbidden(
          "comment.not_author", "Only the author can change a comment");
    }
    return row;
  }

  private Set<UUID> checkedMentions(UUID workspaceId, JsonNode body) {
    Set<UUID> mentions = RichText.mentions(body);
    if (!mentions.isEmpty()
        && workspaces.membersAmong(workspaceId, mentions).size() != mentions.size()) {
      throw TaskflowException.badRequest(
          "comment.invalid_mention", "Only members of the workspace can be mentioned");
    }
    return mentions;
  }

  private void syncMentions(UUID workspaceId, UUID commentId, Set<UUID> mentions) {
    jdbc.update("DELETE FROM comment_mention WHERE comment_id = ?", commentId);
    for (UUID user : mentions) {
      jdbc.update(
          "INSERT INTO comment_mention (workspace_id, comment_id, user_id) VALUES (?, ?, ?)",
          workspaceId,
          commentId,
          user);
    }
  }

  private List<CommentView> views(List<Row> rows) {
    if (rows.isEmpty()) {
      return List.of();
    }
    List<UUID> authorIds = rows.stream().map(Row::authorId).distinct().toList();
    Map<UUID, UserInfo> people = users.byIds(authorIds);
    Set<UUID> automated = automationAuthors.authorsAmong(authorIds);
    Map<UUID, List<UUID>> mentions = new HashMap<>();
    for (Row r : rows) {
      mentions.put(
          r.id(),
          jdbc.queryForList(
              "SELECT user_id FROM comment_mention WHERE comment_id = ? ORDER BY user_id",
              UUID.class,
              r.id()));
    }
    List<CommentView> out = new ArrayList<>();
    for (Row r : rows) {
      UserInfo author = people.get(r.authorId());
      out.add(
          new CommentView(
              r.id(),
              r.taskId(),
              r.authorId(),
              author == null ? null : author.displayName(),
              r.body(),
              mentions.get(r.id()),
              r.createdAt(),
              r.editedAt(),
              automated.contains(r.authorId())));
    }
    return out;
  }

  private Row load(UUID id) {
    return jdbc
        .query(
            "SELECT id, workspace_id, task_id, author_id, body::text AS body, created_at, edited_at FROM"
                + " comment WHERE id = ?",
            (rs, i) -> row(rs),
            id)
        .stream()
        .findFirst()
        .orElseThrow(() -> TaskflowException.notFound("comment.not_found", "Comment not found"));
  }

  private Row row(java.sql.ResultSet rs) throws java.sql.SQLException {
    try {
      java.sql.Timestamp edited = rs.getTimestamp("edited_at");
      return new Row(
          rs.getObject("id", UUID.class),
          rs.getObject("workspace_id", UUID.class),
          rs.getObject("task_id", UUID.class),
          rs.getObject("author_id", UUID.class),
          mapper.readTree(rs.getString("body")),
          rs.getTimestamp("created_at").toInstant(),
          edited == null ? null : edited.toInstant());
    } catch (JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
  }

  private String json(JsonNode node) {
    try {
      return mapper.writeValueAsString(node);
    } catch (JsonProcessingException e) {
      throw new IllegalArgumentException(e);
    }
  }
}
