package com.taskflow.view;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/**
 * One View config shape (AD-4, view-config.md). Built-in task fields only; the validator in {@code
 * view.internal} holds the catalog.
 *
 * @param v schema version, always 1
 * @param filter filter tree: a group when {@code items} is set, a condition otherwise
 * @param group grouping key: none, status, statusGroup, priority, assignee, dueDate, list
 * @param sort one or two sort keys
 * @param columns ordered columns for List and Table
 * @param mode Calendar mode: month or week
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = false)
public record ViewConfig(
    int v, Filter filter, String group, List<Sort> sort, List<Column> columns, String mode) {

  /**
   * A group ({@code op} AND or OR with {@code items}) or a condition ({@code field}, {@code op}).
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Filter(String op, String field, JsonNode value, List<Filter> items) {}

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Sort(String key, String dir) {}

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record Column(String field, Integer width) {}

  public static ViewConfig empty() {
    return new ViewConfig(1, null, null, null, null, null);
  }
}
