package com.taskflow.workspace.internal;

import com.taskflow.identity.UserDirectory;
import com.taskflow.identity.UserInfo;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.Hashing;
import com.taskflow.shared.Ids;
import com.taskflow.shared.Page;
import com.taskflow.shared.PageCursor;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.Role;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Invites by email link (AUTH-4, AD-21). */
@Service
class InviteService {

  static final Duration VALIDITY = Duration.ofDays(7);

  enum Status {
    PENDING,
    ACCEPTED,
    REVOKED,
    EXPIRED
  }

  record InviteView(
      UUID id, UUID workspaceId, String email, Role role, Status status, Instant expiresAt) {}

  record InvitePreview(String workspaceName, String email, Role role, Instant expiresAt) {}

  record Accepted(UUID workspaceId, Role role, boolean alreadyMember) {}

  /** Published in the creating transaction; the mailer sends after commit. */
  record InviteCreated(String email, String workspaceName, String token, Instant expiresAt) {}

  private record Row(
      UUID id,
      UUID workspaceId,
      String email,
      Role role,
      Instant expiresAt,
      Instant acceptedAt,
      Instant revokedAt,
      String workspaceName) {
    Status status() {
      if (acceptedAt != null) {
        return Status.ACCEPTED;
      }
      if (revokedAt != null) {
        return Status.REVOKED;
      }
      return expiresAt.isBefore(Instant.now()) ? Status.EXPIRED : Status.PENDING;
    }
  }

  private static final RowMapper<Row> ROW =
      (rs, i) ->
          new Row(
              rs.getObject("id", UUID.class),
              rs.getObject("workspace_id", UUID.class),
              rs.getString("email"),
              Role.valueOf(rs.getString("role")),
              rs.getTimestamp("expires_at").toInstant(),
              rs.getTimestamp("accepted_at") == null
                  ? null
                  : rs.getTimestamp("accepted_at").toInstant(),
              rs.getTimestamp("revoked_at") == null
                  ? null
                  : rs.getTimestamp("revoked_at").toInstant(),
              rs.getString("workspace_name"));

  private static final String SELECT =
      "SELECT i.id, i.workspace_id, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at,"
          + " w.name AS workspace_name FROM invite i JOIN workspace w ON w.id = i.workspace_id AND"
          + " w.deleted_at IS NULL";

  private final JdbcTemplate jdbc;
  private final EventRecorder events;
  private final UserDirectory users;
  private final ApplicationEventPublisher publisher;
  private final MembershipLookup memberships;

  InviteService(
      JdbcTemplate jdbc,
      EventRecorder events,
      UserDirectory users,
      ApplicationEventPublisher publisher,
      MembershipLookup memberships) {
    this.jdbc = jdbc;
    this.events = events;
    this.users = users;
    this.publisher = publisher;
    this.memberships = memberships;
  }

  @Transactional
  InviteView create(UUID workspaceId, String email, Role role) {
    if (role == Role.OWNER) {
      throw TaskflowException.badRequest(
          "invite.owner_not_invitable", "The owner role cannot be given by invite");
    }
    String normalized = email.trim().toLowerCase(Locale.ROOT);
    users
        .byEmail(normalized)
        .ifPresent(u -> {
          Integer member =
              jdbc.queryForObject(
                  "SELECT count(*) FROM workspace_member WHERE workspace_id = ? AND user_id = ?",
                  Integer.class,
                  workspaceId,
                  u.id());
          if (member != null && member > 0) {
            throw TaskflowException.conflict(
                "invite.already_member", "That person is already a member");
          }
        });
    String token = Hashing.newToken();
    UUID id = Ids.newId();
    Instant expires = Instant.now().plus(VALIDITY);
    jdbc.update(
        "INSERT INTO invite (id, workspace_id, email, role, token_hash, invited_by, expires_at)"
            + " VALUES (?, ?, ?, ?, ?, ?, ?)",
        id,
        workspaceId,
        normalized,
        role.name(),
        Hashing.sha256Hex(token),
        CurrentActor.userId(),
        Timestamp.from(expires));
    events.record(
        workspaceId,
        "invite",
        id,
        "member.invited",
        Map.of("email", normalized, "role", role.name()));
    String workspaceName =
        jdbc.queryForObject("SELECT name FROM workspace WHERE id = ?", String.class, workspaceId);
    publisher.publishEvent(new InviteCreated(normalized, workspaceName, token, expires));
    return new InviteView(id, workspaceId, normalized, role, Status.PENDING, expires);
  }

  @Transactional(readOnly = true)
  Page<InviteView> list(UUID workspaceId, String cursor, Integer requestedLimit) {
    int limit = PageCursor.limit(requestedLimit);
    List<String> after = PageCursor.decode(cursor, 1);
    List<Row> rows =
        jdbc.query(
            SELECT
                + " WHERE i.workspace_id = ?"
                + (after == null ? "" : " AND i.id > ?")
                + " ORDER BY i.id LIMIT ?",
            ROW,
            after == null
                ? new Object[] {workspaceId, limit + 1}
                : new Object[] {workspaceId, UUID.fromString(after.get(0)), limit + 1});
    Page<Row> page = PageCursor.page(rows, limit, r -> PageCursor.encode(r.id().toString()));
    return new Page<>(page.items().stream().map(InviteService::view).toList(), page.nextCursor());
  }

  @Transactional
  void revoke(UUID workspaceId, UUID inviteId) {
    int updated =
        jdbc.update(
            "UPDATE invite SET revoked_at = now() WHERE id = ? AND workspace_id = ? AND revoked_at IS"
                + " NULL AND accepted_at IS NULL",
            inviteId,
            workspaceId);
    if (updated == 0) {
      Integer exists =
          jdbc.queryForObject(
              "SELECT count(*) FROM invite WHERE id = ? AND workspace_id = ?",
              Integer.class,
              inviteId,
              workspaceId);
      if (exists == null || exists == 0) {
        throw TaskflowException.notFound("invite.not_found", "Invite not found");
      }
      return;
    }
    events.record(workspaceId, "invite", inviteId, "invite.revoked", Map.of());
  }

  @Transactional(readOnly = true)
  InvitePreview preview(String token) {
    Row row = usable(find(token));
    return new InvitePreview(row.workspaceName(), row.email(), row.role(), row.expiresAt());
  }

  @Transactional
  Accepted accept(String token) {
    Row row = find(token);
    UserInfo me =
        users
            .byId(CurrentActor.userId())
            .orElseThrow(() -> TaskflowException.notFound("user.not_found", "User not found"));
    if (!me.email().equalsIgnoreCase(row.email())) {
      throw TaskflowException.forbidden(
          "invite.wrong_email", "This invite was sent to a different email address");
    }
    Integer member =
        jdbc.queryForObject(
            "SELECT count(*) FROM workspace_member WHERE workspace_id = ? AND user_id = ?",
            Integer.class,
            row.workspaceId(),
            me.id());
    if (member != null && member > 0) {
      return new Accepted(
          row.workspaceId(),
          Role.valueOf(
              jdbc.queryForObject(
                  "SELECT role FROM workspace_member WHERE workspace_id = ? AND user_id = ?",
                  String.class,
                  row.workspaceId(),
                  me.id())),
          true);
    }
    usable(row);
    int claimed =
        jdbc.update(
            "UPDATE invite SET accepted_at = now() WHERE id = ? AND accepted_at IS NULL AND"
                + " revoked_at IS NULL",
            row.id());
    if (claimed == 0) {
      throw new TaskflowException(
          HttpStatus.GONE, "invite.accepted", "This invite was already used");
    }
    jdbc.update(
        "INSERT INTO workspace_member (workspace_id, user_id, role) VALUES (?, ?, ?)",
        row.workspaceId(),
        me.id(),
        row.role().name());
    memberships.invalidate();
    events.record(
        row.workspaceId(),
        "member",
        me.id(),
        "member.joined",
        Map.of("role", row.role().name(), "inviteId", row.id().toString()));
    return new Accepted(row.workspaceId(), row.role(), false);
  }

  private Row find(String token) {
    return jdbc.query(SELECT + " WHERE i.token_hash = ?", ROW, Hashing.sha256Hex(token)).stream()
        .findFirst()
        .orElseThrow(() -> TaskflowException.notFound("invite.not_found", "Invite not found"));
  }

  private static Row usable(Row row) {
    switch (row.status()) {
      case PENDING:
        return row;
      case EXPIRED:
        throw new TaskflowException(HttpStatus.GONE, "invite.expired", "This invite has expired");
      case REVOKED:
        throw new TaskflowException(HttpStatus.GONE, "invite.revoked", "This invite was revoked");
      default:
        throw new TaskflowException(
            HttpStatus.GONE, "invite.accepted", "This invite was already used");
    }
  }

  private static InviteView view(Row row) {
    return new InviteView(
        row.id(), row.workspaceId(), row.email(), row.role(), row.status(), row.expiresAt());
  }
}
