package com.taskflow.notification.internal;

import com.taskflow.identity.UserDirectory;
import com.taskflow.identity.UserInfo;
import com.taskflow.shared.Actor;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.Page;
import com.taskflow.shared.PageCursor;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.LocationAccess;
import com.taskflow.workspace.Role;
import com.taskflow.workspace.WorkspaceQuery;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * One person's inbox in one Workspace (CAP-11). Every list and count query re-applies the
 * visibility condition, so a notification about a task the person can no longer see disappears from
 * both (AD-11). The owner is always passed in: REST uses the caller, MCP the service account's
 * owner.
 */
@Service
class InboxService {

  record NotificationView(
      UUID id,
      String kind,
      UUID taskId,
      String taskReadableId,
      String taskTitle,
      String actorType,
      String actorName,
      String ruleName,
      String message,
      boolean read,
      Instant readAt,
      Instant createdAt) {}

  record UnreadCount(long count) {}

  private final NamedParameterJdbcTemplate named;
  private final WorkspaceQuery workspaces;
  private final UserDirectory users;
  private final EventRecorder events;

  InboxService(
      NamedParameterJdbcTemplate named,
      WorkspaceQuery workspaces,
      UserDirectory users,
      EventRecorder events) {
    this.named = named;
    this.workspaces = workspaces;
    this.users = users;
    this.events = events;
  }

  private static final String FROM =
      " FROM notification n JOIN task t ON t.workspace_id = n.workspace_id AND t.id = n.task_id AND"
          + " t.deleted_at IS NULL JOIN workspace w ON w.id = n.workspace_id JOIN location l ON"
          + " l.workspace_id = t.workspace_id AND l.id = t.list_id WHERE n.recipient_id = :me AND"
          + " n.workspace_id = :ws AND ";

  private MapSqlParameterSource params(UUID workspaceId, UUID me) {
    Role role =
        workspaces
            .roleOf(workspaceId, me)
            .orElseThrow(
                () -> TaskflowException.notFound("workspace.not_found", "Workspace not found"));
    return new MapSqlParameterSource(LocationAccess.params(me, role))
        .addValue("me", me)
        .addValue("ws", workspaceId);
  }

  @Transactional(readOnly = true)
  Page<NotificationView> list(
      UUID workspaceId, UUID me, boolean unreadOnly, String cursor, Integer requestedLimit) {
    int limit = PageCursor.limit(requestedLimit);
    MapSqlParameterSource params = params(workspaceId, me).addValue("n", limit + 1);
    String keyset = "";
    List<String> after = PageCursor.decode(cursor, 2);
    if (after != null) {
      keyset = " AND (n.created_at, n.id) < (:at, :after)";
      params
          .addValue("at", Timestamp.from(Instant.parse(after.get(0))))
          .addValue("after", PageCursor.uuid(after.get(1)));
    }
    List<Object[]> rows =
        named.query(
            "SELECT n.id, n.kind, n.task_id, w.key || '-' || t.number AS readable, t.title,"
                + " n.actor_type, n.actor_id, n.rule_name, n.message, n.read_at, n.created_at"
                + FROM
                + LocationAccess.visible("l")
                + (unreadOnly ? " AND n.read_at IS NULL" : "")
                + keyset
                + " ORDER BY n.created_at DESC, n.id DESC LIMIT :n",
            params,
            (rs, i) ->
                new Object[] {
                  rs.getObject("id", UUID.class),
                  rs.getString("kind"),
                  rs.getObject("task_id", UUID.class),
                  rs.getString("readable"),
                  rs.getString("title"),
                  rs.getString("actor_type"),
                  rs.getObject("actor_id", UUID.class),
                  rs.getString("rule_name"),
                  rs.getString("message"),
                  rs.getTimestamp("read_at"),
                  rs.getTimestamp("created_at")
                });
    Set<UUID> actors = new HashSet<>();
    for (Object[] r : rows) {
      if (!"AUTOMATION".equals(r[5])) {
        actors.add((UUID) r[6]);
      }
    }
    Map<UUID, UserInfo> names = users.byIds(actors);
    Map<UUID, NotificationView> views = new LinkedHashMap<>();
    for (Object[] r : rows) {
      String actorType = (String) r[5];
      String actorName =
          "AUTOMATION".equals(actorType)
              ? (r[7] != null ? (String) r[7] : "Taskflow")
              : names.containsKey((UUID) r[6]) ? names.get((UUID) r[6]).displayName() : "Someone";
      Timestamp readAt = (Timestamp) r[9];
      views.put(
          (UUID) r[0],
          new NotificationView(
              (UUID) r[0],
              (String) r[1],
              (UUID) r[2],
              (String) r[3],
              (String) r[4],
              actorType,
              actorName,
              (String) r[7],
              (String) r[8],
              readAt != null,
              readAt == null ? null : readAt.toInstant(),
              ((Timestamp) r[10]).toInstant()));
    }
    return PageCursor.page(
        List.copyOf(views.values()),
        limit,
        v -> PageCursor.encode(v.createdAt().toString(), v.id().toString()));
  }

  @Transactional(readOnly = true)
  UnreadCount unreadCount(UUID workspaceId, UUID me) {
    Long n =
        named.queryForObject(
            "SELECT count(*)" + FROM + LocationAccess.visible("l") + " AND n.read_at IS NULL",
            params(workspaceId, me),
            Long.class);
    return new UnreadCount(n == null ? 0 : n);
  }

  /** Marks one notification read or unread; someone else's (or a missing one) is a 404. */
  @Transactional
  void setRead(UUID notificationId, UUID me, boolean read) {
    setRead(notificationId, me, read, null);
  }

  /** As above, and when {@code workspaceId} is given only a notification of that Workspace. */
  @Transactional
  void setRead(UUID notificationId, UUID me, boolean read, UUID workspaceId) {
    List<UUID> ws =
        named.queryForList(
            "SELECT workspace_id FROM notification WHERE id = :id AND recipient_id = :me"
                + " AND (CAST(:ws AS uuid) IS NULL OR workspace_id = CAST(:ws AS uuid))",
            new MapSqlParameterSource("id", notificationId)
                .addValue("me", me)
                .addValue("ws", workspaceId),
            UUID.class);
    if (ws.isEmpty()) {
      throw TaskflowException.notFound("notification.not_found", "Notification not found");
    }
    named.update(
        "UPDATE notification SET read_at = "
            + (read ? "COALESCE(read_at, now())" : "NULL")
            + " WHERE id = :id",
        new MapSqlParameterSource("id", notificationId));
    events.record(
        ws.get(0),
        "notification",
        notificationId,
        "notification.read",
        Map.of("recipientId", me.toString(), "workspaceId", ws.get(0).toString()),
        Actor.SYSTEM);
  }

  /** Marks the person's unread notifications up to and including {@code upToId} (or all) read. */
  @Transactional
  long readAll(UUID workspaceId, UUID me, UUID upToId) {
    MapSqlParameterSource params = params(workspaceId, me);
    String bound = "";
    if (upToId != null) {
      List<Timestamp> at =
          named.queryForList(
              "SELECT created_at FROM notification WHERE id = :id AND recipient_id = :me AND"
                  + " workspace_id = :ws",
              params.addValue("id", upToId),
              Timestamp.class);
      if (at.isEmpty()) {
        throw TaskflowException.notFound("notification.not_found", "Notification not found");
      }
      params.addValue("at", at.get(0));
      bound = " AND (n.created_at, n.id) <= (:at, :id)";
    }
    int changed =
        named.update(
            "UPDATE notification SET read_at = now() WHERE id IN (SELECT n.id"
                + FROM
                + LocationAccess.visible("l")
                + " AND n.read_at IS NULL"
                + bound
                + ")",
            params);
    if (changed > 0) {
      events.record(
          workspaceId,
          "notification",
          upToId != null ? upToId : UUID.randomUUID(),
          "notification.read_all",
          Map.of("recipientId", me.toString(), "workspaceId", workspaceId.toString()),
          Actor.SYSTEM);
    }
    return changed;
  }
}
