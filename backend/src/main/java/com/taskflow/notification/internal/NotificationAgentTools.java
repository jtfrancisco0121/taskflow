package com.taskflow.notification.internal;

import com.taskflow.identity.ServiceAccounts;
import com.taskflow.shared.AgentTool;
import com.taskflow.shared.AgentToolArgs;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.WorkspaceQuery;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The inbox tools of an agent (CAP-14, AD-16). They act on the inbox of the service account's
 * owner, the person who created it, in the service account's Workspace. With no owner, or an owner
 * who is no longer a member, they fail with {@code notification.no_owner} and touch nothing.
 */
@Configuration
class NotificationAgentTools {

  private final InboxService inbox;
  private final ServiceAccounts accounts;
  private final WorkspaceQuery workspaces;

  NotificationAgentTools(InboxService inbox, ServiceAccounts accounts, WorkspaceQuery workspaces) {
    this.inbox = inbox;
    this.accounts = accounts;
    this.workspaces = workspaces;
  }

  private record Scope(UUID workspaceId, UUID owner) {}

  private Scope scope() {
    UUID account = CurrentActor.userId();
    UUID workspace =
        accounts
            .workspaceOf(account)
            .orElseThrow(
                () -> TaskflowException.forbidden("auth.forbidden", "Not a service account"));
    UUID owner =
        accounts
            .ownerOf(account)
            .filter(o -> workspaces.roleOf(workspace, o).isPresent())
            .orElseThrow(() ->
                TaskflowException.conflict(
                    "notification.no_owner",
                    "This service account has no owner in the Workspace, so it has no inbox"));
    return new Scope(workspace, owner);
  }

  @Bean
  AgentTool listNotificationsTool() {
    return AgentTool.of(
        "list_notifications",
        "List the notifications in the inbox of this service account's owner, newest first. Pass"
            + " unread=true for unread ones only, and the nextCursor of a page as cursor for the next.",
        """
        {"type": "object", "properties": {
          "unread": {"type": "boolean"},
          "cursor": {"type": "string"},
          "limit": {"type": "integer", "minimum": 1, "maximum": 200}
        }}
        """,
        args -> {
          Scope s = scope();
          return inbox.list(
              s.workspaceId(),
              s.owner(),
              AgentToolArgs.optBoolean(args, "unread"),
              AgentToolArgs.optText(args, "cursor"),
              AgentToolArgs.optInt(args, "limit"));
        });
  }

  @Bean
  AgentTool markNotificationReadTool() {
    return AgentTool.of(
        "mark_notification_read",
        "Mark a notification in the inbox of this service account's owner as read.",
        """
        {"type": "object", "required": ["notificationId"], "properties": {
          "notificationId": {"type": "string", "format": "uuid"}
        }}
        """,
        args -> {
          Scope s = scope();
          UUID id = AgentToolArgs.uuid(args, "notificationId");
          inbox.setRead(id, s.owner(), true, s.workspaceId());
          return Map.of("notificationId", id.toString(), "read", true);
        });
  }
}
