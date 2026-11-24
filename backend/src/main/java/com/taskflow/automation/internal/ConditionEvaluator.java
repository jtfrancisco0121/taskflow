package com.taskflow.automation.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.automation.internal.RuleDocs.Condition;
import com.taskflow.field.FieldCatalog;
import com.taskflow.field.StatusCatalog;
import com.taskflow.field.StatusInfo;
import com.taskflow.task.TaskView;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.springframework.stereotype.Component;

/** Conditions are ANDed and read the task as it is when the run executes (CAP-4). */
@Component
class ConditionEvaluator {

  private final StatusCatalog statuses;
  private final FieldCatalog fields;

  ConditionEvaluator(StatusCatalog statuses, FieldCatalog fields) {
    this.statuses = statuses;
    this.fields = fields;
  }

  boolean holds(List<Condition> conditions, TaskView task) {
    for (Condition c : conditions) {
      if (!holds(c, task)) {
        return false;
      }
    }
    return true;
  }

  private boolean holds(Condition c, TaskView task) {
    return switch (c.type()) {
      case "STATUS" -> {
        String name =
            statuses
                .find(task.statusId())
                .map(StatusInfo::name)
                .map(AutomationText::norm)
                .orElse("");
        boolean listed = c.values().stream().map(AutomationText::norm).anyMatch(name::equals);
        yield c.operator().equals("IS_ONE_OF") == listed;
      }
      case "PRIORITY" -> {
        boolean listed = c.values().contains(task.priority().name());
        yield c.operator().equals("IS_ONE_OF") == listed;
      }
      case "ASSIGNEE" ->
          switch (c.operator()) {
            case "INCLUDES" -> task.assigneeIds().contains(c.personId());
            case "IS_EMPTY" -> task.assigneeIds().isEmpty();
            default -> !task.assigneeIds().isEmpty();
          };
      case "CUSTOM_FIELD" -> customField(c, task);
      case "TAG" -> {
        boolean has =
            task.tags().stream()
                .anyMatch(t ->
                    t.toLowerCase(Locale.ROOT).equals(c.tag().strip().toLowerCase(Locale.ROOT)));
        yield c.operator().equals("HAS") == has;
      }
      default -> false;
    };
  }

  private boolean customField(Condition c, TaskView task) {
    JsonNode stored =
        task.customFields() == null ? null : task.customFields().get(c.fieldId().toString());
    boolean empty =
        stored == null
            || stored.isNull()
            || (stored.isTextual() && stored.asText().isBlank())
            || (stored.isArray() && stored.isEmpty());
    return switch (c.operator()) {
      case "IS_EMPTY" -> empty;
      case "IS_NOT_EMPTY" -> !empty;
      default -> !empty && equalsValue(c, stored);
    };
  }

  /** Equal as text, or, for a Dropdown or Labels field, equal to the name of the stored Option. */
  private boolean equalsValue(Condition c, JsonNode stored) {
    String wanted = AutomationText.norm(String.valueOf(c.value()));
    if (stored.isArray()) {
      for (JsonNode item : stored) {
        if (matches(c, item.asText(), wanted)) {
          return true;
        }
      }
      return false;
    }
    return matches(c, stored.asText(), wanted);
  }

  private boolean matches(Condition c, String text, String wanted) {
    if (AutomationText.norm(text).equals(wanted)) {
      return true;
    }
    Optional<String> optionName =
        fields.lookup(c.fieldId()).stream()
            .flatMap(f -> f.options().stream())
            .filter(o -> o.id().toString().equals(text))
            .map(o -> o.name())
            .findFirst();
    return optionName.map(AutomationText::norm).filter(wanted::equals).isPresent();
  }
}
