package com.taskflow.field.internal;

import com.taskflow.shared.AgentTool;
import com.taskflow.shared.AgentToolArgs;
import com.taskflow.workspace.Action;
import com.taskflow.workspace.Permissions;
import java.util.UUID;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The custom field tool an agent can call over MCP (CAP-9, AD-10). It does what the REST endpoint
 * does: the same permission check, the same service method, the same body.
 */
@Configuration
class FieldAgentTools {

  private final CustomFieldService fields;
  private final Permissions permissions;

  FieldAgentTools(CustomFieldService fields, Permissions permissions) {
    this.fields = fields;
    this.permissions = permissions;
  }

  @Bean
  AgentTool listCustomFieldsTool() {
    return AgentTool.of(
        "list_custom_fields",
        "List the custom fields of a Space, Folder or List: the ones it defines and the ones it"
            + " inherits (each with definedAt, the Location it comes from), with their type, config"
            + " and Options. Use a field's id or name, and a Dropdown or Labels Option's name, as keys"
            + " and values of customFields in create_task, update_task and search_tasks.",
        """
        {"type": "object", "required": ["locationId"], "properties": {
          "locationId": {"type": "string", "format": "uuid"}
        }}
        """,
        args -> {
          UUID id = AgentToolArgs.uuid(args, "locationId");
          permissions.require(Permissions.LOCATION, id, Action.VIEW);
          return fields.list(id);
        });
  }
}
