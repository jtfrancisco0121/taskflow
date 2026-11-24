package com.taskflow.automation.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.automation.internal.RuleDocs.Action;
import com.taskflow.automation.internal.RuleDocs.Condition;
import com.taskflow.automation.internal.RuleDocs.Trigger;
import com.taskflow.shared.AgentTool;
import com.taskflow.shared.AgentToolArgs;
import com.taskflow.workspace.Permissions;
import java.util.List;
import java.util.UUID;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The automation tools an agent can call over MCP (CAP-14, AD-16). They call the same service
 * methods as the REST endpoints, so permissions, validation and problem codes are the same.
 */
@Configuration
class AutomationAgentTools {

  private static final String RULE_SCHEMA_NOTE =
      " trigger is {type: TASK_CREATED | STATUS_CHANGED | ASSIGNEE_CHANGED | CUSTOM_FIELD_CHANGED |"
          + " DUE_DATE_APPROACHING | DUE_DATE_ARRIVED, fromStatuses?, toStatuses? (status names),"
          + " personId?, fieldId?}. conditions are {type: STATUS | PRIORITY | ASSIGNEE | CUSTOM_FIELD |"
          + " TAG, operator, values?, personId?, fieldId?, value?, tag?}. actions are {type:"
          + " CHANGE_STATUS | ASSIGN | SET_PRIORITY | ADD_COMMENT | SET_DUE_DATE | CREATE_SUBTASK |"
          + " SEND_NOTIFICATION, status?, personIds?, unassignAll?, priority?, text?, daysAfter?,"
          + " clearDueDate?, title?, recipients? (ASSIGNEES, WATCHERS), message?}.";

  private final AutomationRuleService rules;
  private final Permissions permissions;
  private final ObjectMapper mapper;

  AutomationAgentTools(AutomationRuleService rules, Permissions permissions, ObjectMapper mapper) {
    this.rules = rules;
    this.permissions = permissions;
    this.mapper = mapper;
  }

  @Bean
  AgentTool listAutomationsTool() {
    return AgentTool.of(
        "list_automations",
        "List the automation rules of a Space, Folder or List: the ones it defines and the ones it"
            + " inherits (each with definedAt, creator and the last run). Each has an id, a version"
            + " and an enabled flag.",
        """
        {"type": "object", "required": ["locationId"], "properties": {
          "locationId": {"type": "string", "format": "uuid"}
        }}
        """,
        args -> rules.list(AgentToolArgs.uuid(args, "locationId")));
  }

  @Bean
  AgentTool createAutomationTool() {
    return AgentTool.withIdempotencyKey(createAutomation());
  }

  private AgentTool createAutomation() {
    return AgentTool.of(
        "create_automation",
        "Create an automation rule at a Space, Folder or List: when a trigger fires for a task below"
            + " it, and all conditions hold, the actions run in order."
            + RULE_SCHEMA_NOTE,
        """
        {"type": "object", "required": ["locationId", "name", "trigger", "actions"], "properties": {
          "locationId": {"type": "string", "format": "uuid"},
          "name": {"type": "string"},
          "enabled": {"type": "boolean"},
          "trigger": {"type": "object"},
          "conditions": {"type": "array", "items": {"type": "object"}},
          "actions": {"type": "array", "items": {"type": "object"}}
        }}
        """,
        args -> {
          UUID location = AgentToolArgs.uuid(args, "locationId");
          return rules.create(
              location,
              new AutomationRuleService.CreateInput(
                  AgentToolArgs.text(args, "name"),
                  args.hasNonNull("enabled") ? args.get("enabled").asBoolean() : null,
                  read(args, "trigger", Trigger.class),
                  list(args, "conditions", new TypeReference<List<Condition>>() {}),
                  list(args, "actions", new TypeReference<List<Action>>() {})));
        });
  }

  @Bean
  AgentTool toggleAutomationTool() {
    return AgentTool.of(
        "toggle_automation",
        "Switch an automation rule on or off.",
        """
        {"type": "object", "required": ["automationId", "enabled"], "properties": {
          "automationId": {"type": "string", "format": "uuid"},
          "enabled": {"type": "boolean"}
        }}
        """,
        args -> {
          UUID id = AgentToolArgs.uuid(args, "automationId");
          if (!args.hasNonNull("enabled") || !args.get("enabled").isBoolean()) {
            throw AgentToolArgs.invalid("enabled must be true or false");
          }
          permissions.require("AUTOMATION", id, com.taskflow.workspace.Action.VIEW);
          AutomationRuleService.RuleView current = rules.get(id);
          return rules.update(
              id,
              current.version(),
              new AutomationRuleService.UpdateInput(
                  null, args.get("enabled").asBoolean(), null, null, null));
        });
  }

  private <T> T read(JsonNode args, String field, Class<T> type) {
    JsonNode v = args.get(field);
    if (v == null || v.isNull()) {
      throw AgentToolArgs.invalid(field + " is required");
    }
    try {
      return mapper.treeToValue(v, type);
    } catch (JsonProcessingException e) {
      throw AgentToolArgs.invalid(field + " is not valid: " + e.getOriginalMessage());
    }
  }

  private <T> List<T> list(JsonNode args, String field, TypeReference<List<T>> type) {
    JsonNode v = args.get(field);
    if (v == null || v.isNull()) {
      return List.of();
    }
    try {
      return mapper.readValue(mapper.treeAsTokens(v), type);
    } catch (java.io.IOException e) {
      throw AgentToolArgs.invalid(field + " is not valid: " + e.getMessage());
    }
  }
}
