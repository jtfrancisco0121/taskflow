package com.taskflow.automation.internal;

import com.taskflow.automation.internal.RuleDocs.Action;
import com.taskflow.automation.internal.RuleDocs.Condition;
import com.taskflow.automation.internal.RuleDocs.Trigger;
import com.taskflow.field.FieldCatalog;
import com.taskflow.field.FieldInfo;
import com.taskflow.field.StatusCatalog;
import com.taskflow.shared.TaskflowException;
import com.taskflow.task.Priority;
import com.taskflow.workspace.WorkspaceQuery;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Checks a rule's documents against the catalogue and the live data (AD-14): status names against
 * the Location's effective statuses, people against Workspace members, fields against the
 * Location's effective fields. A failure is a 400 with an {@code automation.invalid_*} code.
 */
@Component
class RuleValidator {

  static final int MAX_NAME = 100;
  static final int MAX_CONDITIONS = 10;
  static final int MAX_ACTIONS = 10;
  static final int MAX_COMMENT = 10_000;
  static final int MAX_MESSAGE = 500;
  static final int MAX_VALUES = 20;

  private final StatusCatalog statuses;
  private final FieldCatalog fields;
  private final WorkspaceQuery workspaces;

  RuleValidator(StatusCatalog statuses, FieldCatalog fields, WorkspaceQuery workspaces) {
    this.statuses = statuses;
    this.fields = fields;
    this.workspaces = workspaces;
  }

  static String name(String raw) {
    String name = raw == null ? "" : raw.strip();
    if (name.isEmpty() || name.length() > MAX_NAME) {
      throw TaskflowException.badRequest(
          "automation.invalid_name", "The name must be 1 to " + MAX_NAME + " characters");
    }
    return name;
  }

  void validate(
      UUID workspaceId,
      UUID locationId,
      Trigger trigger,
      List<Condition> conditions,
      List<Action> actions) {
    Set<String> statusNames = new HashSet<>();
    statuses.effectiveSet(locationId).forEach(s -> statusNames.add(lower(s.name())));
    Set<UUID> fieldIds = new HashSet<>();
    for (FieldInfo f : fields.effective(locationId)) {
      fieldIds.add(f.id());
    }
    trigger(workspaceId, trigger, statusNames, fieldIds);
    if (conditions.size() > MAX_CONDITIONS) {
      throw TaskflowException.badRequest(
          "automation.invalid_condition",
          "A rule can have up to " + MAX_CONDITIONS + " conditions");
    }
    for (Condition c : conditions) {
      condition(workspaceId, c, statusNames, fieldIds);
    }
    if (actions.isEmpty()) {
      throw TaskflowException.badRequest(
          "automation.invalid_action", "A rule needs at least one action");
    }
    if (actions.size() > MAX_ACTIONS) {
      throw TaskflowException.badRequest(
          "automation.invalid_action", "A rule can have up to " + MAX_ACTIONS + " actions");
    }
    for (Action a : actions) {
      action(workspaceId, a, statusNames);
    }
  }

  private void trigger(UUID ws, Trigger t, Set<String> statusNames, Set<UUID> fieldIds) {
    if (t == null || t.type() == null || !RuleDocs.TRIGGERS.contains(t.type())) {
      throw bad("automation.invalid_trigger", "Unknown trigger type");
    }
    switch (t.type()) {
      case "STATUS_CHANGED" -> {
        names("automation.invalid_trigger", t.fromStatuses(), statusNames);
        names("automation.invalid_trigger", t.toStatuses(), statusNames);
      }
      case "ASSIGNEE_CHANGED" -> {
        if (t.personId() != null) {
          member("automation.invalid_trigger", ws, t.personId());
        }
      }
      case "CUSTOM_FIELD_CHANGED" -> {
        if (t.fieldId() == null || !fieldIds.contains(t.fieldId())) {
          throw bad("automation.invalid_trigger", "Choose a custom field of this location");
        }
      }
      default -> {}
    }
  }

  private void condition(UUID ws, Condition c, Set<String> statusNames, Set<UUID> fieldIds) {
    String code = "automation.invalid_condition";
    if (c == null || c.type() == null || !RuleDocs.CONDITIONS.contains(c.type())) {
      throw bad(code, "Unknown condition type");
    }
    String op = c.operator() == null ? "" : c.operator();
    switch (c.type()) {
      case "STATUS" -> {
        oneOf(code, op, "IS_ONE_OF", "IS_NOT_ONE_OF");
        if (c.values() == null || c.values().isEmpty()) {
          throw bad(code, "Choose at least one status");
        }
        names(code, c.values(), statusNames);
      }
      case "PRIORITY" -> {
        oneOf(code, op, "IS_ONE_OF", "IS_NOT_ONE_OF");
        if (c.values() == null || c.values().isEmpty()) {
          throw bad(code, "Choose at least one priority");
        }
        for (String p : c.values()) {
          priority(code, p);
        }
      }
      case "ASSIGNEE" -> {
        oneOf(code, op, "INCLUDES", "IS_EMPTY", "IS_NOT_EMPTY");
        if (op.equals("INCLUDES")) {
          if (c.personId() == null) {
            throw bad(code, "Choose a person");
          }
          member(code, ws, c.personId());
        }
      }
      case "CUSTOM_FIELD" -> {
        oneOf(code, op, "EQUALS", "IS_EMPTY", "IS_NOT_EMPTY");
        if (c.fieldId() == null || !fieldIds.contains(c.fieldId())) {
          throw bad(code, "Choose a custom field of this location");
        }
        if (op.equals("EQUALS") && c.value() == null) {
          throw bad(code, "Give a value to compare with");
        }
      }
      case "TAG" -> {
        oneOf(code, op, "HAS", "NOT_HAS");
        if (c.tag() == null || c.tag().isBlank() || c.tag().length() > 50) {
          throw bad(code, "Give a tag of 1 to 50 characters");
        }
      }
      default -> throw bad(code, "Unknown condition type");
    }
  }

  private void action(UUID ws, Action a, Set<String> statusNames) {
    String code = "automation.invalid_action";
    if (a == null || a.type() == null || !RuleDocs.ACTIONS.contains(a.type())) {
      throw bad(code, "Unknown action type");
    }
    switch (a.type()) {
      case "CHANGE_STATUS" -> {
        if (a.status() == null || !statusNames.contains(lower(a.status()))) {
          throw bad(code, "That status is not offered here");
        }
      }
      case "ASSIGN" -> {
        boolean unassign = Boolean.TRUE.equals(a.unassignAll());
        boolean people = a.personIds() != null && !a.personIds().isEmpty();
        if (unassign == people) {
          throw bad(code, "Choose people to assign, or unassign all");
        }
        if (people) {
          for (UUID p : a.personIds()) {
            member(code, ws, p);
          }
        }
      }
      case "SET_PRIORITY" -> priority(code, a.priority());
      case "ADD_COMMENT" -> {
        if (a.text() == null || a.text().isBlank() || a.text().length() > MAX_COMMENT) {
          throw bad(code, "The comment must be 1 to " + MAX_COMMENT + " characters");
        }
      }
      case "SET_DUE_DATE" -> {
        boolean clear = Boolean.TRUE.equals(a.clearDueDate());
        Integer days = a.daysAfter();
        if (clear == (days != null) || (days != null && (days < 0 || days > 365))) {
          throw bad(code, "Give 0 to 365 days after the trigger, or clear the due date");
        }
      }
      case "CREATE_SUBTASK" -> {
        if (a.title() == null || a.title().isBlank() || a.title().length() > 500) {
          throw bad(code, "The subtask title must be 1 to 500 characters");
        }
      }
      case "SEND_NOTIFICATION" -> {
        List<String> recipients = a.recipients() == null ? List.of() : a.recipients();
        for (String r : recipients) {
          if (!r.equals("ASSIGNEES") && !r.equals("WATCHERS")) {
            throw bad(code, "Recipients are ASSIGNEES, WATCHERS or specific people");
          }
        }
        boolean people = a.personIds() != null && !a.personIds().isEmpty();
        if (recipients.isEmpty() && !people) {
          throw bad(code, "Choose who to notify");
        }
        if (people) {
          for (UUID p : a.personIds()) {
            member(code, ws, p);
          }
        }
        if (a.message() == null || a.message().isBlank() || a.message().length() > MAX_MESSAGE) {
          throw bad(code, "The message must be 1 to " + MAX_MESSAGE + " characters");
        }
      }
      default -> throw bad(code, "Unknown action type");
    }
  }

  private void names(String code, List<String> names, Set<String> known) {
    if (names == null) {
      return;
    }
    if (names.size() > MAX_VALUES) {
      throw bad(code, "Too many statuses");
    }
    for (String n : names) {
      if (n == null || !known.contains(lower(n))) {
        throw bad(code, "Status '" + n + "' is not offered here");
      }
    }
  }

  private void member(String code, UUID ws, UUID person) {
    if (!workspaces.membersAmong(ws, List.of(person)).contains(person)) {
      throw bad(code, "That person is not a member of this Workspace");
    }
  }

  private static void priority(String code, String p) {
    try {
      Priority.valueOf(p == null ? "" : p);
    } catch (IllegalArgumentException e) {
      throw bad(code, "Unknown priority");
    }
  }

  private static void oneOf(String code, String op, String... allowed) {
    for (String a : allowed) {
      if (a.equals(op)) {
        return;
      }
    }
    throw bad(code, "Unknown operator " + op);
  }

  private static String lower(String s) {
    return s.strip().toLowerCase(Locale.ROOT);
  }

  private static TaskflowException bad(String code, String message) {
    return TaskflowException.badRequest(code, message);
  }
}
