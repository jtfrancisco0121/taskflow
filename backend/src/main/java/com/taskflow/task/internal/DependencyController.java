package com.taskflow.task.internal;

import com.taskflow.shared.Idempotent;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
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
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Relationships of a task (DEP-1..DEP-3). */
@RestController
@RequestMapping("/api/v1")
class DependencyController {

  /**
   * {@code relation} is seen from the path task: WAITING_ON (alias BLOCKED_BY), BLOCKING or LINKED.
   */
  record AddDependencyRequest(@NotNull UUID otherTaskId, @NotBlank String relation) {}

  private final DependencyService service;

  DependencyController(DependencyService service) {
    this.service = service;
  }

  @GetMapping("/tasks/{id}/dependencies")
  @PreAuthorize("hasPermission(#id, 'TASK', 'VIEW')")
  public DependencyService.DependencyList list(@PathVariable UUID id) {
    return service.list(id);
  }

  @Idempotent
  @PostMapping("/tasks/{id}/dependencies")
  @PreAuthorize("hasPermission(#id, 'TASK', 'EDIT')")
  public ResponseEntity<DependencyService.DependencyAdded> add(
      @PathVariable UUID id,
      @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
      @Valid @org.springframework.web.bind.annotation.RequestBody AddDependencyRequest request) {
    DependencyService.DependencyAdded added =
        service.add(
            id,
            TaskController.version(ifMatch),
            request.otherTaskId(),
            DependencyService.Relation.parse(request.relation()));
    return ResponseEntity.status(HttpStatus.CREATED)
        .header(HttpHeaders.ETAG, "\"" + added.task().version() + "\"")
        .body(added);
  }

  @DeleteMapping("/tasks/{id}/dependencies/{dependencyId}")
  @PreAuthorize("hasPermission(#id, 'TASK', 'EDIT')")
  public ResponseEntity<Void> remove(
      @PathVariable UUID id,
      @PathVariable UUID dependencyId,
      @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch) {
    DependencyService.DependencyRemoved removed =
        service.remove(id, TaskController.version(ifMatch), dependencyId);
    return ResponseEntity.noContent()
        .header(HttpHeaders.ETAG, "\"" + removed.task().version() + "\"")
        .build();
  }
}
