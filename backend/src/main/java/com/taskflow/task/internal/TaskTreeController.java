package com.taskflow.task.internal;

import com.taskflow.shared.Idempotent;
import com.taskflow.shared.Page;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
class TaskTreeController {

  record MoveTaskRequest(@NotNull UUID listId, UUID beforeId, UUID afterId, UUID statusId) {}

  record DuplicateTaskRequest(UUID listId) {}

  private final TaskTreeService service;

  TaskTreeController(TaskTreeService service) {
    this.service = service;
  }

  @PostMapping("/tasks/{id}/move")
  @PreAuthorize("hasPermission(#id, 'TASK', 'EDIT')")
  public ResponseEntity<TaskView> move(
      @PathVariable UUID id,
      @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
      @RequestBody @jakarta.validation.Valid MoveTaskRequest request) {
    return TaskController.etag(
        ResponseEntity.ok(),
        service.move(
            id,
            TaskController.version(ifMatch),
            request.listId(),
            request.beforeId(),
            request.afterId(),
            request.statusId()));
  }

  @Idempotent
  @PostMapping("/tasks/{id}/duplicate")
  @PreAuthorize("hasPermission(#id, 'TASK', 'CREATE')")
  public ResponseEntity<TaskView> duplicate(
      @PathVariable UUID id, @RequestBody(required = false) DuplicateTaskRequest request) {
    TaskView copy = service.duplicate(id, request == null ? null : request.listId());
    return TaskController.etag(
        ResponseEntity.status(HttpStatus.CREATED)
            .header(HttpHeaders.LOCATION, "/api/v1/tasks/" + copy.id()),
        copy);
  }

  @DeleteMapping("/tasks/{id}")
  @PreAuthorize("hasPermission(#id, 'TASK', 'DELETE')")
  public ResponseEntity<Void> delete(
      @PathVariable UUID id,
      @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch) {
    service.trash(id, TaskController.version(ifMatch));
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/tasks/{id}/restore")
  @PreAuthorize("hasPermission(#id, 'TASK', 'RESTORE')")
  public ResponseEntity<TaskView> restore(
      @PathVariable UUID id,
      @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch) {
    return TaskController.etag(
        ResponseEntity.ok(), service.restore(id, TaskController.version(ifMatch)));
  }

  @GetMapping("/workspaces/{id}/trash")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'VIEW')")
  public Page<TaskTreeService.TrashItem> trash(
      @PathVariable UUID id,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Integer limit) {
    return service.trashList(id, cursor, limit);
  }
}
