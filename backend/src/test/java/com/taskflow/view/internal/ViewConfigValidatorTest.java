package com.taskflow.view.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.shared.TaskflowException;
import com.taskflow.view.ViewConfig;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("VIEW-1 config validation")
class ViewConfigValidatorTest {

  private static final ObjectMapper M = new ObjectMapper();

  private static ViewConfig.Filter cond(String field, String op, String valueJson) {
    try {
      JsonNode v = valueJson == null ? null : M.readTree(valueJson);
      return new ViewConfig.Filter(op, field, v, null);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private static ViewConfig with(ViewConfig.Filter f) {
    return new ViewConfig(1, f, null, null, null, null);
  }

  private static String sampleValue(String field, String op) {
    if (op.equals("is_set")
        || op.equals("is_empty")
        || op.equals("overdue")
        || op.equals("include")
        || op.equals("exclude")) {
      return null;
    }
    return switch (field) {
      case "title" -> "\"fix\"";
      case "status", "list" -> "[\"018f1e2a-0000-7000-8000-000000000001\"]";
      case "statusGroup" -> "[\"ACTIVE\"]";
      case "priority" -> "[\"URGENT\"]";
      case "assignee" -> "[\"me\"]";
      case "tag" -> "[\"bug\"]";
      default -> op.equals("between") ? "[\"2026-01-01\",\"today\"]" : "\"2026-01-31\"";
    };
  }

  @Test
  void everyFieldAndOperatorOfTheCatalogIsAccepted() {
    int checked = 0;
    for (var e : ViewConfigValidator.catalog().entrySet()) {
      for (String op : e.getValue()) {
        ViewConfigValidator.validate(with(cond(e.getKey(), op, sampleValue(e.getKey(), op))));
        checked++;
      }
    }
    assertThat(checked).isGreaterThan(40);
  }

  @Test
  void anUnknownFieldOperatorOrValueIsRefused() {
    assertRefused(with(cond("nope", "any_of", "[\"x\"]")));
    assertRefused(with(cond("title", "any_of", "\"x\"")));
    assertRefused(with(cond("priority", "any_of", "[\"HUGE\"]")));
    assertRefused(with(cond("dueDate", "before", "\"yesterday\"")));
    assertRefused(with(cond("startDate", "overdue", null)));
    assertRefused(with(cond("status", "any_of", "[\"not-a-uuid\"]")));
  }

  @Test
  void depthFourAndFiftyOneConditionsAreRefused() {
    ViewConfig.Filter leaf = cond("title", "contains", "\"a\"");
    ViewConfig.Filter d3 =
        new ViewConfig.Filter(
            "AND",
            null,
            null,
            List.of(
                new ViewConfig.Filter(
                    "OR",
                    null,
                    null,
                    List.of(new ViewConfig.Filter("AND", null, null, List.of(leaf))))));
    ViewConfigValidator.validate(with(d3));
    ViewConfig.Filter d4 =
        new ViewConfig.Filter(
            "AND",
            null,
            null,
            List.of(
                new ViewConfig.Filter(
                    "OR",
                    null,
                    null,
                    List.of(
                        new ViewConfig.Filter(
                            "AND",
                            null,
                            null,
                            List.of(new ViewConfig.Filter("OR", null, null, List.of(leaf))))))));
    assertRefused(with(d4));
    List<ViewConfig.Filter> many = new ArrayList<>();
    for (int i = 0; i < 51; i++) {
      many.add(leaf);
    }
    assertRefused(with(new ViewConfig.Filter("AND", null, null, many)));
    ViewConfigValidator.validate(
        with(new ViewConfig.Filter("AND", null, null, many.subList(0, 50))));
  }

  @Test
  void columnsSortAndGroupingFollowTheCatalog() {
    ViewConfigValidator.validate(
        new ViewConfig(
            1,
            null,
            "assignee",
            List.of(new ViewConfig.Sort("dueDate", "asc"), new ViewConfig.Sort("title", "desc")),
            List.of(new ViewConfig.Column("title", 300), new ViewConfig.Column("status", 60)),
            "week"));
    assertRefused(new ViewConfig(1, null, "bogus", null, null, null));
    assertRefused(
        new ViewConfig(
            1,
            null,
            null,
            List.of(
                new ViewConfig.Sort("title", "asc"),
                new ViewConfig.Sort("status", "asc"),
                new ViewConfig.Sort("priority", "asc")),
            null,
            null));
    assertRefused(
        new ViewConfig(1, null, null, null, List.of(new ViewConfig.Column("status", 100)), null));
    assertRefused(
        new ViewConfig(1, null, null, null, List.of(new ViewConfig.Column("title", 59)), null));
    assertRefused(
        new ViewConfig(1, null, null, null, List.of(new ViewConfig.Column("title", 801)), null));
    assertRefused(new ViewConfig(1, null, null, null, null, "year"));
    assertRefused(new ViewConfig(2, null, null, null, null, null));
  }

  private static void assertRefused(ViewConfig config) {
    assertThatThrownBy(() -> ViewConfigValidator.validate(config))
        .isInstanceOfSatisfying(
            TaskflowException.class, e -> assertThat(e.code()).isEqualTo("view.invalid_config"));
  }

  private static ViewConfig columns(String... fields) {
    return new ViewConfig(
        1,
        null,
        null,
        null,
        java.util.Arrays.stream(fields).map(f -> new ViewConfig.Column(f, null)).toList(),
        null);
  }

  @Test
  @DisplayName("a custom field column cf:<id> is accepted (AD-8)")
  void aCustomFieldColumnIsAccepted() {
    ViewConfigValidator.validate(columns("title", "cf:" + UUID.randomUUID()));
  }

  @Test
  @DisplayName("a malformed custom field column is refused (AD-8)")
  void aMalformedCustomFieldColumnIsRefused() {
    for (String bad : List.of("cf:", "cf:nope", "cf:" + UUID.randomUUID() + ":x", "custom")) {
      assertThatThrownBy(() -> ViewConfigValidator.validate(columns("title", bad)))
          .isInstanceOf(TaskflowException.class)
          .extracting(e -> ((TaskflowException) e).code())
          .isEqualTo("view.invalid_config");
    }
    assertThat(ViewConfigValidator.customReference("cf:" + UUID.randomUUID())).isTrue();
    assertThat(ViewConfigValidator.customReference(null)).isFalse();
  }
}
