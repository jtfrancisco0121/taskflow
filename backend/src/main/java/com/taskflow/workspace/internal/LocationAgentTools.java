package com.taskflow.workspace.internal;

import com.taskflow.identity.ServiceAccounts;
import com.taskflow.shared.AgentTool;
import com.taskflow.shared.AgentToolArgs;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.Action;
import com.taskflow.workspace.Permissions;
import java.util.UUID;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** The Space/Folder/List tree for agents (MCP-3): the same data as GET /workspaces/{id}/tree. */
@Configuration
class LocationAgentTools {

  private final LocationService locations;
  private final Permissions permissions;
  private final ServiceAccounts serviceAccounts;

  LocationAgentTools(
      LocationService locations, Permissions permissions, ServiceAccounts serviceAccounts) {
    this.locations = locations;
    this.permissions = permissions;
    this.serviceAccounts = serviceAccounts;
  }

  @Bean
  AgentTool listLocationsTool() {
    return AgentTool.of(
        "list_locations",
        "List the Spaces of your Workspace, or the Folders and Lists inside parentId. Each entry"
            + " has hasChildren. The ids of Lists are what create_task needs.",
        """
        {"type": "object", "properties": {
          "parentId": {"type": "string", "format": "uuid", "description": "A Space or Folder"},
          "includeArchived": {"type": "boolean"}
        }}
        """,
        args -> {
          UUID workspace =
              serviceAccounts
                  .workspaceOf(CurrentActor.userId())
                  .orElseThrow(() ->
                      TaskflowException.forbidden(
                          "auth.forbidden", "Only a service account can do this"));
          permissions.require(Permissions.WORKSPACE, workspace, Action.VIEW);
          return locations.tree(
              workspace,
              AgentToolArgs.optUuid(args, "parentId"),
              AgentToolArgs.optBoolean(args, "includeArchived"));
        });
  }
}
