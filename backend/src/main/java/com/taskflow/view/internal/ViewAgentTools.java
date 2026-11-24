package com.taskflow.view.internal;

import com.taskflow.shared.AgentTool;
import com.taskflow.shared.AgentToolArgs;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Saved views of a Location for agents (MCP-3): the same data as GET /locations/{id}/views. */
@Configuration
class ViewAgentTools {

  private final ViewService views;

  ViewAgentTools(ViewService views) {
    this.views = views;
  }

  @Bean
  AgentTool listViewsTool() {
    return AgentTool.of(
        "list_views",
        "List the saved views (List, Board, Table, Calendar) of a Space, Folder or List.",
        """
        {"type": "object", "required": ["locationId"], "properties": {
          "locationId": {"type": "string", "format": "uuid"}
        }}
        """,
        args -> views.forLocation(AgentToolArgs.uuid(args, "locationId")));
  }
}
