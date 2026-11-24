package com.taskflow.automation.internal;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.UUID;

/**
 * The three typed documents of a rule (AD-14, catalogs.md). One record per catalogue part with a
 * {@code type} discriminator; the options a type does not use stay null. REST, MCP and the engine
 * all parse into these, so the stored JSON has one shape.
 */
final class RuleDocs {

  private RuleDocs() {}

  static final List<String> TRIGGERS =
      List.of(
          "TASK_CREATED",
          "STATUS_CHANGED",
          "ASSIGNEE_CHANGED",
          "CUSTOM_FIELD_CHANGED",
          "DUE_DATE_APPROACHING",
          "DUE_DATE_ARRIVED");
  static final List<String> CONDITIONS =
      List.of("STATUS", "PRIORITY", "ASSIGNEE", "CUSTOM_FIELD", "TAG");
  static final List<String> ACTIONS =
      List.of(
          "CHANGE_STATUS",
          "ASSIGN",
          "SET_PRIORITY",
          "ADD_COMMENT",
          "SET_DUE_DATE",
          "CREATE_SUBTASK",
          "SEND_NOTIFICATION");

  /**
   * {@code fromStatuses}/{@code toStatuses} are status names; {@code personId} narrows
   * ASSIGNEE_CHANGED.
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  record Trigger(
      String type,
      List<String> fromStatuses,
      List<String> toStatuses,
      UUID personId,
      UUID fieldId) {}

  /**
   * Operators: STATUS/PRIORITY {@code IS_ONE_OF|IS_NOT_ONE_OF} with {@code values}; ASSIGNEE {@code
   * INCLUDES} with {@code personId}, {@code IS_EMPTY}, {@code IS_NOT_EMPTY}; CUSTOM_FIELD {@code
   * EQUALS} with {@code value}, {@code IS_EMPTY}, {@code IS_NOT_EMPTY}; TAG {@code HAS|NOT_HAS}
   * with {@code tag}.
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  record Condition(
      String type,
      String operator,
      List<String> values,
      UUID personId,
      UUID fieldId,
      Object value,
      String tag) {}

  /** {@code recipients} of SEND_NOTIFICATION: ASSIGNEES and/or WATCHERS, plus {@code personIds}. */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  record Action(
      String type,
      String status,
      List<UUID> personIds,
      Boolean unassignAll,
      String priority,
      String text,
      Integer daysAfter,
      Boolean clearDueDate,
      String title,
      List<String> recipients,
      String message) {}
}
