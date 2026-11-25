package com.taskflow.task;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The public write API of the task module for other modules, used by automation actions (AD-7).
 * Each method delegates to the same services as the REST endpoints, so validation, optimistic
 * locking ({@code expectedVersion}), events and blocker transitions are the same. It performs no
 * permission check beyond the ones those services make for the current actor.
 */
public interface TaskCommands {

  /** Moves the task to the status of its List's effective set with this name (case-insensitive). */
  TaskView setStatus(UUID taskId, long expectedVersion, String statusName);

  /** Adds people to the task's assignees. */
  TaskView addAssignees(UUID taskId, long expectedVersion, List<UUID> personIds);

  /** Removes every assignee. */
  TaskView clearAssignees(UUID taskId, long expectedVersion);

  TaskView setPriority(UUID taskId, long expectedVersion, Priority priority);

  /** Sets the due date, or clears it when {@code dueDate} is null. */
  TaskView setDueDate(UUID taskId, long expectedVersion, Instant dueDate);

  /** Adds a plain-text comment, one paragraph per line. */
  void addComment(UUID taskId, String text);

  /** Creates a subtask in the same List as the parent. */
  TaskView createSubtask(UUID parentTaskId, String title);
}
