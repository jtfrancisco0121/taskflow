package com.taskflow.notification.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.identity.UserDirectory;
import com.taskflow.identity.UserInfo;
import com.taskflow.notification.DigestHook;
import com.taskflow.shared.Actor;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.Ids;
import com.taskflow.workspace.LocationAccess;
import com.taskflow.workspace.Role;
import com.taskflow.workspace.WorkspaceQuery;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.ArrayList;
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
import org.springframework.transaction.annotation.Transactional;

/**
 * One event, one transaction (AD-3, AD-11, AD-19): watcher changes, recipient resolution, and
 * notifications inserted with {@code ON CONFLICT DO NOTHING}. A redelivery inserts nothing and
 * changes no watcher; only inserted rows record {@code notification.created}.
 */
@Component
class NotificationProcessor {

  static final Set<String> TYPES =
      Set.of(
          "task.created",
          "task.updated",
          "task.status_changed",
          "task.due_soon",
          "task.blocker_resolved",
          "comment.created",
          "comment.edited",
          "automation.notify_requested");

  private final JdbcTemplate jdbc;
  private final NamedParameterJdbcTemplate named;
  private final WorkspaceQuery workspaces;
  private final UserDirectory users;
  private final EventRecorder events;
  private final PreferenceStore preferences;
  private final DigestHook digest;
  private final MeterRegistry meters;

  NotificationProcessor(
      JdbcTemplate jdbc,
      NamedParameterJdbcTemplate named,
      WorkspaceQuery workspaces,
      UserDirectory users,
      EventRecorder events,
      PreferenceStore preferences,
      DigestHook digest,
      MeterRegistry meters) {
    this.jdbc = jdbc;
    this.named = named;
    this.workspaces = workspaces;
    this.users = users;
    this.events = events;
    this.preferences = preferences;
    this.digest = digest;
    this.meters = meters;
  }

  @Transactional
  public void process(JsonNode envelope) {
    String type = envelope.get("type").asText();
    if (!TYPES.contains(type)) {
      return;
    }
    UUID eventId = UUID.fromString(envelope.get("id").asText());
    UUID workspaceId = UUID.fromString(envelope.get("workspaceId").asText());
    JsonNode payload = envelope.path("payload");
    String actorType = envelope.get("actorType").asText();
    UUID actorId = UUID.fromString(envelope.get("actorId").asText());
    UUID actorKeyId =
        envelope.hasNonNull("actorKeyId")
            ? UUID.fromString(envelope.get("actorKeyId").asText())
            : null;
    boolean forRule = type.equals("automation.notify_requested");
    UUID taskId =
        UUID.fromString(
            forRule ? payload.get("taskId").asText() : envelope.get("entityId").asText());
    if (!taskExists(workspaceId, taskId)) {
      return;
    }
    JsonNode changes = payload.path("changes");

    // 1. Who should hear about it, MENTIONED winning over any other kind for the same person.
    Map<UUID, String> recipients = new LinkedHashMap<>();
    UUID commentId =
        payload.hasNonNull("commentId") ? UUID.fromString(payload.get("commentId").asText()) : null;
    switch (type) {
      case "task.created" -> addAll(recipients, added(changes.path("assigneeIds")), "ASSIGNED");
      case "task.updated" -> {
        addAll(recipients, added(changes.path("assigneeIds")), "ASSIGNED");
        if (changes.has("statusId")) {
          addAll(recipients, watchers(taskId), "STATUS_CHANGED");
        }
      }
      case "task.status_changed" -> addAll(recipients, watchers(taskId), "STATUS_CHANGED");
      case "task.due_soon" -> addAll(recipients, assignees(taskId), "DUE_SOON");
      case "task.blocker_resolved" -> {
        if (!payload.path("stillBlocked").asBoolean(false)) {
          addAll(recipients, assignees(taskId), "BLOCKER_RESOLVED");
          addAll(recipients, watchers(taskId), "BLOCKER_RESOLVED");
        }
      }
      case "comment.created", "comment.edited" -> {
        addAll(recipients, uuids(payload.path("mentions")), "MENTIONED");
        if (type.equals("comment.created")) {
          addAll(recipients, watchers(taskId), "COMMENTED");
        }
      }
      case "automation.notify_requested" -> {
        for (JsonNode r : payload.path("recipients")) {
          if (r.asText().equals("ASSIGNEES")) {
            addAll(recipients, assignees(taskId), "AUTOMATION");
          } else if (r.asText().equals("WATCHERS")) {
            addAll(recipients, watchers(taskId), "AUTOMATION");
          }
        }
        addAll(recipients, uuids(payload.path("personIds")), "AUTOMATION");
      }
      default -> {}
    }

    // 2. Filter (AD-11) and insert idempotently.
    List<UUID> assignedNow = new ArrayList<>();
    List<UUID> mentionedNow = new ArrayList<>();
    for (Map.Entry<UUID, String> r : recipients.entrySet()) {
      UUID recipient = r.getKey();
      String kind = r.getValue();
      if (recipient.equals(actorId) || !human(recipient)) {
        continue;
      }
      Role role = workspaces.roleOf(workspaceId, recipient).orElse(null);
      if (role == null || !canView(taskId, recipient, role)) {
        continue;
      }
      if (!preferences.inApp(workspaceId, recipient, kind)) {
        continue;
      }
      UUID id = Ids.newId();
      List<UUID> inserted =
          jdbc.query(
              "INSERT INTO notification (id, workspace_id, recipient_id, kind, task_id, comment_id,"
                  + " source_event_id, actor_type, actor_id, actor_key_id, rule_name, message)"
                  + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING"
                  + " id",
              (rs, i) -> rs.getObject(1, UUID.class),
              id,
              workspaceId,
              recipient,
              kind,
              taskId,
              kind.equals("MENTIONED") || kind.equals("COMMENTED") ? commentId : null,
              eventId,
              actorType,
              actorId,
              actorKeyId,
              forRule ? payload.path("ruleName").asText(null) : null,
              forRule ? payload.path("message").asText(null) : null);
      if (inserted.isEmpty()) {
        continue;
      }
      meters.counter("taskflow.notifications.created", "kind", kind).increment();
      if (preferences.emailDigest(workspaceId, recipient, kind)) {
        digest.accept(new DigestHook.Entry(id, workspaceId, recipient, kind, taskId));
      }
      Map<String, Object> body = new LinkedHashMap<>();
      body.put("recipientId", recipient.toString());
      body.put("workspaceId", workspaceId.toString());
      events.record(workspaceId, "notification", id, "notification.created", body, Actor.SYSTEM);
      if (kind.equals("ASSIGNED")) {
        assignedNow.add(recipient);
      } else if (kind.equals("MENTIONED")) {
        mentionedNow.add(recipient);
      }
    }

    // 3. Watchers (AD-19): only people, only from this event's inserted rows or its own actor.
    if ((type.equals("task.created") || type.equals("comment.created"))
        && actorType.equals("USER")
        && human(actorId)) {
      watchIfAbsent(workspaceId, taskId, actorId);
    }
    for (UUID u : assignedNow) {
      watch(workspaceId, taskId, u, true);
    }
    for (UUID u : mentionedNow) {
      watch(workspaceId, taskId, u, true);
    }
  }

  // ------------------------------------------------------------------ helpers

  private void addAll(Map<UUID, String> into, Iterable<UUID> ids, String kind) {
    for (UUID id : ids) {
      into.putIfAbsent(id, kind);
    }
  }

  private static List<UUID> uuids(JsonNode array) {
    List<UUID> out = new ArrayList<>();
    for (JsonNode n : array) {
      out.add(UUID.fromString(n.asText()));
    }
    return out;
  }

  /** People in {@code to} that are not in {@code from} (a created task has no {@code from}). */
  private static List<UUID> added(JsonNode change) {
    Set<String> before = new HashSet<>();
    if (change.path("from").isArray()) {
      change.get("from").forEach(n -> before.add(n.asText()));
    }
    List<UUID> out = new ArrayList<>();
    for (JsonNode n : change.path("to")) {
      if (!before.contains(n.asText())) {
        out.add(UUID.fromString(n.asText()));
      }
    }
    return out;
  }

  private boolean taskExists(UUID workspaceId, UUID taskId) {
    return !jdbc.queryForList(
            "SELECT 1 FROM task WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL",
            Integer.class,
            workspaceId,
            taskId)
        .isEmpty();
  }

  private List<UUID> watchers(UUID taskId) {
    return jdbc.queryForList(
        "SELECT user_id FROM task_watcher WHERE task_id = ? AND watching ORDER BY user_id",
        UUID.class,
        taskId);
  }

  private List<UUID> assignees(UUID taskId) {
    return jdbc.queryForList(
        "SELECT user_id FROM task_assignee WHERE task_id = ? ORDER BY user_id", UUID.class, taskId);
  }

  /** A person: service accounts and the Automation author have no email. */
  private boolean human(UUID userId) {
    return users.byId(userId).map(UserInfo::email).isPresent();
  }

  private boolean canView(UUID taskId, UUID userId, Role role) {
    MapSqlParameterSource params =
        new MapSqlParameterSource(LocationAccess.params(userId, role)).addValue("tid", taskId);
    Boolean visible =
        named.queryForObject(
            "SELECT EXISTS (SELECT 1 FROM task t JOIN location l ON l.workspace_id = t.workspace_id"
                + " AND l.id = t.list_id WHERE t.id = :tid AND t.deleted_at IS NULL AND "
                + LocationAccess.visible("l")
                + ")",
            params,
            Boolean.class);
    return Boolean.TRUE.equals(visible);
  }

  private void watchIfAbsent(UUID workspaceId, UUID taskId, UUID userId) {
    jdbc.update(
        "INSERT INTO task_watcher (workspace_id, task_id, user_id, watching) VALUES (?, ?, ?, true)"
            + " ON CONFLICT DO NOTHING",
        workspaceId,
        taskId,
        userId);
  }

  void watch(UUID workspaceId, UUID taskId, UUID userId, boolean watching) {
    jdbc.update(
        "INSERT INTO task_watcher (workspace_id, task_id, user_id, watching) VALUES (?, ?, ?, ?) ON"
            + " CONFLICT (task_id, user_id) DO UPDATE SET watching = EXCLUDED.watching, updated_at ="
            + " now()",
        workspaceId,
        taskId,
        userId,
        watching);
  }
}
