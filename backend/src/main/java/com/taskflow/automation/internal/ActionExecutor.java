package com.taskflow.automation.internal;

import com.taskflow.automation.internal.RuleDocs.Action;
import com.taskflow.shared.EventRecorder;
import com.taskflow.task.Priority;
import com.taskflow.task.TaskCommands;
import com.taskflow.task.TaskView;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Runs one action through {@link TaskCommands}, so it gets the validation, optimistic locking,
 * events and blocker transitions of any other write (AD-7). Always called inside an {@code
 * AutomationCause}.
 */
@Component
class ActionExecutor {

  private final TaskCommands commands;
  private final EventRecorder events;

  ActionExecutor(TaskCommands commands, EventRecorder events) {
    this.commands = commands;
    this.events = events;
  }

  void execute(
      Action action, TaskView task, EngineEvent event, AutomationRuleRunner.LoadedRule rule) {
    UUID id = task.id();
    switch (action.type()) {
      case "CHANGE_STATUS" -> commands.setStatus(id, task.version(), action.status());
      case "ASSIGN" -> {
        if (Boolean.TRUE.equals(action.unassignAll())) {
          commands.clearAssignees(id, task.version());
        } else {
          commands.addAssignees(id, task.version(), action.personIds());
        }
      }
      case "SET_PRIORITY" ->
          commands.setPriority(id, task.version(), Priority.valueOf(action.priority()));
      case "ADD_COMMENT" -> commands.addComment(id, action.text());
      case "SET_DUE_DATE" ->
          commands.setDueDate(
              id,
              task.version(),
              Boolean.TRUE.equals(action.clearDueDate())
                  ? null
                  : event.createdAt().plus(action.daysAfter(), ChronoUnit.DAYS));
      case "CREATE_SUBTASK" -> commands.createSubtask(id, action.title());
      case "SEND_NOTIFICATION" -> requestNotification(action, task, rule);
      default -> throw new IllegalStateException("unknown action " + action.type());
    }
  }

  /** The notification module turns this event into inbox entries; automation never calls it. */
  private void requestNotification(
      Action action, TaskView task, AutomationRuleRunner.LoadedRule rule) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("taskId", task.id().toString());
    payload.put("listId", task.listId().toString());
    payload.put("locationId", rule.row().locationId().toString());
    payload.put("ruleName", rule.row().name());
    payload.put("message", action.message());
    payload.put("recipients", action.recipients() == null ? List.of() : action.recipients());
    payload.put(
        "personIds",
        action.personIds() == null
            ? List.of()
            : action.personIds().stream().map(UUID::toString).toList());
    events.record(
        rule.row().workspaceId(),
        "automation",
        rule.row().id(),
        "automation.notify_requested",
        payload);
  }
}
