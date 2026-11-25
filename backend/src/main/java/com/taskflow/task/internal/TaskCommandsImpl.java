package com.taskflow.task.internal;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.taskflow.field.StatusCatalog;
import com.taskflow.field.StatusInfo;
import com.taskflow.shared.TaskflowException;
import com.taskflow.task.Priority;
import com.taskflow.task.TaskCommands;
import com.taskflow.task.TaskView;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Delegates to {@link TaskService} and {@link CommentService}: one write path for tasks (AD-7). */
@Component
class TaskCommandsImpl implements TaskCommands {

  private final TaskService tasks;
  private final CommentService comments;
  private final TaskRepository repo;
  private final StatusCatalog statuses;

  TaskCommandsImpl(
      TaskService tasks, CommentService comments, TaskRepository repo, StatusCatalog statuses) {
    this.tasks = tasks;
    this.comments = comments;
    this.repo = repo;
    this.statuses = statuses;
  }

  private static ObjectNode patch() {
    return JsonNodeFactory.instance.objectNode();
  }

  @Override
  @Transactional
  public TaskView setStatus(UUID taskId, long expectedVersion, String statusName) {
    TaskRepository.Row row = repo.live(taskId);
    String wanted = statusName == null ? "" : statusName.strip().toLowerCase(Locale.ROOT);
    StatusInfo status =
        statuses.effectiveSet(row.listId()).stream()
            .filter(s -> s.name().strip().toLowerCase(Locale.ROOT).equals(wanted))
            .findFirst()
            .orElseThrow(() ->
                TaskflowException.badRequest(
                    "task.invalid_status", "The status is not offered by this List"));
    return tasks.update(taskId, expectedVersion, patch().put("statusId", status.id().toString()));
  }

  @Override
  @Transactional
  public TaskView addAssignees(UUID taskId, long expectedVersion, List<UUID> personIds) {
    Set<UUID> all = new LinkedHashSet<>(repo.view(taskId).assigneeIds());
    all.addAll(personIds);
    ObjectNode patch = patch();
    var array = patch.putArray("assigneeIds");
    all.forEach(id -> array.add(id.toString()));
    return tasks.update(taskId, expectedVersion, patch);
  }

  @Override
  @Transactional
  public TaskView clearAssignees(UUID taskId, long expectedVersion) {
    ObjectNode patch = patch();
    patch.putArray("assigneeIds");
    return tasks.update(taskId, expectedVersion, patch);
  }

  @Override
  @Transactional
  public TaskView setPriority(UUID taskId, long expectedVersion, Priority priority) {
    return tasks.update(taskId, expectedVersion, patch().put("priority", priority.name()));
  }

  @Override
  @Transactional
  public TaskView setDueDate(UUID taskId, long expectedVersion, Instant dueDate) {
    ObjectNode patch = patch();
    if (dueDate == null) {
      patch.putNull("dueDate");
    } else {
      patch.put("dueDate", dueDate.toString());
    }
    return tasks.update(taskId, expectedVersion, patch);
  }

  @Override
  @Transactional
  public void addComment(UUID taskId, String text) {
    comments.create(taskId, PlainText.toDoc(text));
  }

  @Override
  @Transactional
  public TaskView createSubtask(UUID parentTaskId, String title) {
    TaskRepository.Row parent = repo.live(parentTaskId);
    return tasks.create(
        parent.listId(),
        new TaskService.TaskInput(
            title,
            null,
            null,
            null,
            null,
            null,
            new ArrayList<>(),
            new ArrayList<>(),
            parentTaskId,
            null));
  }
}
