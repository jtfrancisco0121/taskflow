package com.taskflow.view.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.shared.TaskflowException;
import com.taskflow.view.ViewConfig;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Checks a config against the catalog of view-config.md; 400 {@code view.invalid_config}. */
public final class ViewConfigValidator {

  static final int MAX_DEPTH = 3;
  static final int MAX_CONDITIONS = 50;
  static final int MIN_WIDTH = 60;
  static final int MAX_WIDTH = 800;

  static final Set<String> GROUPS =
      Set.of("none", "status", "statusGroup", "priority", "assignee", "dueDate", "list");
  static final Set<String> SORT_KEYS =
      Set.of(
          "manual",
          "title",
          "status",
          "priority",
          "dueDate",
          "startDate",
          "createdAt",
          "updatedAt");
  static final Set<String> COLUMNS =
      Set.of(
          "readableId",
          "title",
          "status",
          "priority",
          "assignees",
          "dueDate",
          "startDate",
          "tags",
          "list",
          "createdAt",
          "updatedAt");
  static final Set<String> STATUS_GROUPS = Set.of("NOT_STARTED", "ACTIVE", "DONE", "CLOSED");
  static final Set<String> PRIORITIES = Set.of("URGENT", "HIGH", "NORMAL", "LOW", "NONE");
  static final Set<String> RELATIVE = Set.of("today", "this_week", "next_7_days");

  /** Operators per field. */
  static final Map<String, Set<String>> OPERATORS =
      Map.ofEntries(
          Map.entry("title", Set.of("contains", "not_contains")),
          Map.entry("status", Set.of("any_of", "none_of")),
          Map.entry("statusGroup", Set.of("any_of", "none_of")),
          Map.entry("priority", Set.of("any_of", "none_of", "is_set", "is_empty")),
          Map.entry("assignee", Set.of("any_of", "all_of", "none_of", "is_empty", "is_set")),
          Map.entry("tag", Set.of("any_of", "all_of", "none_of", "is_empty")),
          Map.entry(
              "dueDate",
              Set.of("before", "after", "on", "between", "is_empty", "is_set", "overdue")),
          Map.entry("startDate", Set.of("before", "after", "on", "between", "is_empty", "is_set")),
          Map.entry("createdAt", Set.of("before", "after", "between")),
          Map.entry("updatedAt", Set.of("before", "after", "between")),
          Map.entry("list", Set.of("any_of", "none_of")),
          Map.entry("subtasks", Set.of("include", "exclude")),
          Map.entry("blocked", Set.of("is_true", "is_false")));

  private ViewConfigValidator() {}

  public static void validate(ViewConfig config) {
    if (config == null) {
      throw invalid("A view needs a config");
    }
    if (config.v() != 1) {
      throw invalid("Unsupported config version " + config.v());
    }
    if (config.filter() != null) {
      int[] count = {0};
      node(config.filter(), 1, count);
    }
    if (config.group() != null
        && !GROUPS.contains(config.group())
        && !customReference(config.group())) {
      throw invalid("Unknown grouping " + config.group());
    }
    if (config.sort() != null) {
      if (config.sort().size() > 2) {
        throw invalid("At most two sort keys");
      }
      for (ViewConfig.Sort s : config.sort()) {
        if (s == null
            || !(SORT_KEYS.contains(s.key()) || customReference(s.key()))
            || !(s.dir() == null || s.dir().equals("asc") || s.dir().equals("desc"))) {
          throw invalid("Unknown sort " + (s == null ? null : s.key()));
        }
      }
    }
    if (config.columns() != null) {
      boolean title = false;
      for (ViewConfig.Column c : config.columns()) {
        if (c == null || !(COLUMNS.contains(c.field()) || customReference(c.field()))) {
          throw invalid("Unknown column " + (c == null ? null : c.field()));
        }
        if (c.width() != null && (c.width() < MIN_WIDTH || c.width() > MAX_WIDTH)) {
          throw invalid("Column widths are 60 to 800 pixels");
        }
        title |= c.field().equals("title");
      }
      if (!title && !config.columns().isEmpty()) {
        throw invalid("The title column is always shown");
      }
    }
    if (config.mode() != null && !Set.of("month", "week").contains(config.mode())) {
      throw invalid("Calendar mode is month or week");
    }
  }

  private static void node(ViewConfig.Filter f, int depth, int[] count) {
    if (f == null) {
      throw invalid("Empty filter node");
    }
    if (f.items() != null) {
      if (depth > MAX_DEPTH) {
        throw invalid("Filters nest at most 3 levels");
      }
      if (!"AND".equals(f.op()) && !"OR".equals(f.op())) {
        throw invalid("A group is AND or OR");
      }
      if (f.field() != null) {
        throw invalid("A group has no field");
      }
      for (ViewConfig.Filter child : f.items()) {
        node(child, depth + 1, count);
      }
      return;
    }
    if (++count[0] > MAX_CONDITIONS) {
      throw invalid("At most 50 conditions");
    }
    condition(f);
  }

  private static void condition(ViewConfig.Filter f) {
    if (customReference(f.field())) {
      // The operator and value depend on the field's type: CustomFieldRefs checks them with it.
      return;
    }
    Set<String> ops = f.field() == null ? null : OPERATORS.get(f.field());
    if (ops == null) {
      throw invalid("Unknown filter field " + f.field());
    }
    String op = f.op();
    if (op == null || !ops.contains(op)) {
      throw invalid("Operator " + op + " is not valid for " + f.field());
    }
    JsonNode v = f.value();
    boolean none = v == null || v.isNull();
    switch (f.field()) {
      case "title" -> text(v);
      case "status" -> list(v, ViewConfigValidator::uuid);
      case "list" -> list(v, ViewConfigValidator::uuid);
      case "statusGroup" -> list(v, s -> STATUS_GROUPS.contains(s));
      case "priority" -> {
        if (op.equals("any_of") || op.equals("none_of")) {
          list(v, s -> PRIORITIES.contains(s));
        } else {
          mustBeEmpty(none);
        }
      }
      case "assignee" -> {
        if (op.equals("is_empty") || op.equals("is_set")) {
          mustBeEmpty(none);
        } else {
          list(v, s -> s.equals("me") || uuid(s));
        }
      }
      case "tag" -> {
        if (op.equals("is_empty")) {
          mustBeEmpty(none);
        } else {
          list(v, s -> !s.isBlank() && s.length() <= 50);
        }
      }
      case "dueDate", "startDate", "createdAt", "updatedAt" -> {
        switch (op) {
          case "is_empty", "is_set", "overdue" -> mustBeEmpty(none);
          case "between" -> {
            if (v == null || !v.isArray() || v.size() != 2) {
              throw invalid("between takes two days");
            }
            day(v.get(0));
            day(v.get(1));
          }
          default -> day(v);
        }
      }
      case "subtasks", "blocked" -> mustBeEmpty(none);
      default -> throw invalid("Unknown filter field " + f.field());
    }
  }

  private static void mustBeEmpty(boolean none) {
    if (!none) {
      throw invalid("This operator takes no value");
    }
  }

  private static void text(JsonNode v) {
    if (v == null || !v.isTextual() || v.asText().isBlank() || v.asText().length() > 200) {
      throw invalid("A text value is required");
    }
  }

  private static void list(JsonNode v, java.util.function.Predicate<String> ok) {
    if (v == null || !v.isArray() || v.isEmpty() || v.size() > 50) {
      throw invalid("A list of values is required");
    }
    for (JsonNode n : v) {
      if (!n.isTextual() || !ok.test(n.asText())) {
        throw invalid("Unknown value " + n);
      }
    }
  }

  private static void day(JsonNode v) {
    if (v == null || !v.isTextual()) {
      throw invalid("A UTC day or a relative value is required");
    }
    String s = v.asText();
    if (RELATIVE.contains(s)) {
      return;
    }
    try {
      LocalDate.parse(s);
    } catch (DateTimeParseException e) {
      throw invalid("Days are YYYY-MM-DD or today, this_week, next_7_days");
    }
  }

  /**
   * A custom field column, {@code cf:<fieldId>} (AD-8); whether the field is live is checked by the
   * caller's scope.
   */
  static boolean customReference(String field) {
    return field != null && field.startsWith("cf:") && uuid(field.substring(3));
  }

  private static boolean uuid(String s) {
    try {
      UUID.fromString(s);
      return true;
    } catch (IllegalArgumentException e) {
      return false;
    }
  }

  /** Every field accepted as a filter condition, for tests. */
  public static Map<String, Set<String>> catalog() {
    return OPERATORS;
  }

  static TaskflowException invalid(String message) {
    return TaskflowException.badRequest("view.invalid_config", message);
  }

  static List<String> groups() {
    return List.copyOf(GROUPS);
  }
}
