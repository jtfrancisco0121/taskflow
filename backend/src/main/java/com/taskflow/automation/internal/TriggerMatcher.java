package com.taskflow.automation.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.automation.internal.RuleDocs.Trigger;
import com.taskflow.field.StatusCatalog;
import com.taskflow.field.StatusInfo;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** Whether an outbox event fires a rule's trigger (catalogs.md, CAP-2, CAP-3). */
@Component
class TriggerMatcher {

  private final StatusCatalog statuses;

  TriggerMatcher(StatusCatalog statuses) {
    this.statuses = statuses;
  }

  boolean matches(Trigger trigger, EngineEvent event) {
    String type = event.type();
    JsonNode changes = event.changes();
    return switch (trigger.type()) {
      case "TASK_CREATED" -> type.equals("task.created");
      case "STATUS_CHANGED" ->
          (type.equals("task.status_changed") || type.equals("task.updated"))
              && changes.has("statusId")
              && statusMatches(trigger, changes.get("statusId"));
      case "ASSIGNEE_CHANGED" ->
          (type.equals("task.updated") || type.equals("task.created"))
              && changes.has("assigneeIds")
              && assigneeMatches(trigger, changes.get("assigneeIds"));
      case "CUSTOM_FIELD_CHANGED" ->
          type.equals("task.updated")
              && trigger.fieldId() != null
              && changes.path("customFields").has(trigger.fieldId().toString());
      case "DUE_DATE_APPROACHING" -> type.equals("task.due_soon");
      case "DUE_DATE_ARRIVED" -> type.equals("task.due_reached");
      default -> false;
    };
  }

  private boolean statusMatches(Trigger t, JsonNode change) {
    return nameIn(t.fromStatuses(), change.get("from")) && nameIn(t.toStatuses(), change.get("to"));
  }

  /** An absent or empty list matches any status; otherwise the status name must be listed. */
  private boolean nameIn(List<String> wanted, JsonNode statusId) {
    if (wanted == null || wanted.isEmpty()) {
      return true;
    }
    if (statusId == null || statusId.isNull()) {
      return false;
    }
    String name =
        statuses
            .find(UUID.fromString(statusId.asText()))
            .map(StatusInfo::name)
            .map(n -> n.strip().toLowerCase(Locale.ROOT))
            .orElse(null);
    return name != null
        && wanted.stream().anyMatch(w -> w.strip().toLowerCase(Locale.ROOT).equals(name));
  }

  private static boolean assigneeMatches(Trigger t, JsonNode change) {
    if (t.personId() == null) {
      return true;
    }
    Set<String> before = ids(change.get("from"));
    Set<String> after = ids(change.get("to"));
    String person = t.personId().toString();
    return after.contains(person) && !before.contains(person);
  }

  private static Set<String> ids(JsonNode array) {
    Set<String> out = new HashSet<>();
    if (array != null && array.isArray()) {
      array.forEach(n -> out.add(n.asText()));
    }
    return out;
  }
}
