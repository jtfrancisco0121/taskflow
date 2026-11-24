package com.taskflow.task.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.taskflow.shared.Idempotent;
import com.taskflow.shared.Page;
import com.taskflow.shared.TaskflowException;
import com.taskflow.task.Priority;
import com.taskflow.task.TaskView;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.parameters.RequestBody;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
class TaskController {

  record CreateTaskRequest(
      @NotBlank @Size(max = 500) String title,
      JsonNode description,
      UUID statusId,
      Priority priority,
      Instant startDate,
      Instant dueDate,
      List<UUID> assigneeIds,
      List<@Size(max = 50) String> tags,
      UUID parentTaskId,
      Map<String, JsonNode> customFields) {}

  /**
   * Merge patch: absent fields are untouched, null clears description and the dates. {@code
   * customFields} maps field id (or name) to a value; null clears that field.
   */
  record UpdateTaskRequest(
      String title,
      JsonNode description,
      UUID statusId,
      Priority priority,
      Instant startDate,
      Instant dueDate,
      List<UUID> assigneeIds,
      List<String> tags,
      UUID parentTaskId,
      Map<String, JsonNode> customFields) {}

  private final TaskService service;
  private final ObjectMapper mapper;

  TaskController(TaskService service, ObjectMapper mapper) {
    this.service = service;
    this.mapper = mapper;
  }

  @Idempotent
  @PostMapping("/lists/{id}/tasks")
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'CREATE')")
  public ResponseEntity<TaskView> create(
      @PathVariable UUID id,
      @Valid @org.springframework.web.bind.annotation.RequestBody CreateTaskRequest request) {
    TaskView task =
        service.create(
            id,
            new TaskService.TaskInput(
                request.title(),
                request.description(),
                request.statusId(),
                request.priority(),
                request.startDate(),
                request.dueDate(),
                request.assigneeIds(),
                request.tags(),
                request.parentTaskId(),
                request.customFields()));
    return etag(
        ResponseEntity.status(HttpStatus.CREATED)
            .header(HttpHeaders.LOCATION, "/api/v1/tasks/" + task.id()),
        task);
  }

  @GetMapping("/tasks/{id}")
  @PreAuthorize("hasPermission(#id, 'TASK', 'VIEW')")
  public ResponseEntity<TaskView> get(@PathVariable UUID id) {
    return etag(ResponseEntity.ok(), service.get(id));
  }

  @PatchMapping("/tasks/{id}")
  @PreAuthorize("hasPermission(#id, 'TASK', 'EDIT')")
  @RequestBody(content = @Content(schema = @Schema(implementation = UpdateTaskRequest.class)))
  public ResponseEntity<TaskView> update(
      @PathVariable UUID id,
      @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
      @org.springframework.web.bind.annotation.RequestBody ObjectNode patch) {
    return etag(ResponseEntity.ok(), service.update(id, version(ifMatch), patch));
  }

  @GetMapping("/workspaces/{id}/tasks/by-ref/{ref}")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'VIEW')")
  public ResponseEntity<TaskView> byRef(@PathVariable UUID id, @PathVariable String ref) {
    return etag(ResponseEntity.ok(), service.byRef(id, ref));
  }

  @GetMapping("/tasks")
  public Page<TaskView> list(
      @RequestParam(required = false) UUID locationId,
      @RequestParam(required = false) UUID workspaceId,
      @RequestParam(defaultValue = "false") boolean includeArchived,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Integer limit) {
    return service.list(locationId, workspaceId, includeArchived, cursor, limit);
  }

  static ResponseEntity<TaskView> etag(ResponseEntity.BodyBuilder builder, TaskView task) {
    return builder.header(HttpHeaders.ETAG, "\"" + task.version() + "\"").body(task);
  }

  /** Parses {@code If-Match}: the ETag value, quoted, weak or bare (AD-11). */
  static long version(String ifMatch) {
    if (ifMatch == null || ifMatch.isBlank()) {
      throw new TaskflowException(
          HttpStatus.PRECONDITION_REQUIRED,
          "task.if_match_required",
          "Send the task's ETag in If-Match");
    }
    String v = ifMatch.trim();
    if (v.startsWith("W/")) {
      v = v.substring(2);
    }
    v = v.replace("\"", "");
    try {
      return Long.parseLong(v);
    } catch (NumberFormatException e) {
      throw TaskflowException.badRequest(
          "task.invalid_if_match", "If-Match must be a task version");
    }
  }
}
