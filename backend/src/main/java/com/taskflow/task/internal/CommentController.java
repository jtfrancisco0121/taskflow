package com.taskflow.task.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.shared.Idempotent;
import com.taskflow.shared.Page;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
class CommentController {

  /** A ProseMirror document ({@code type: doc}); mentions are nodes with attrs.id = user id. */
  record CommentRequest(@NotNull JsonNode body) {}

  private final CommentService service;

  CommentController(CommentService service) {
    this.service = service;
  }

  @GetMapping("/tasks/{id}/comments")
  @PreAuthorize("hasPermission(#id, 'TASK', 'VIEW')")
  public Page<CommentService.CommentView> list(
      @PathVariable UUID id,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Integer limit) {
    return service.list(id, cursor, limit);
  }

  @Idempotent
  @PostMapping("/tasks/{id}/comments")
  @PreAuthorize("hasPermission(#id, 'TASK', 'COMMENT')")
  public ResponseEntity<CommentService.CommentView> create(
      @PathVariable UUID id, @Valid @RequestBody CommentRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED).body(service.create(id, request.body()));
  }

  @PatchMapping("/comments/{id}")
  @PreAuthorize("hasPermission(#id, 'COMMENT', 'COMMENT')")
  public CommentService.CommentView edit(
      @PathVariable UUID id, @Valid @RequestBody CommentRequest request) {
    return service.edit(id, request.body());
  }

  @DeleteMapping("/comments/{id}")
  @PreAuthorize("hasPermission(#id, 'COMMENT', 'COMMENT')")
  public ResponseEntity<Void> delete(@PathVariable UUID id) {
    service.delete(id);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/tasks/{id}/activity")
  @PreAuthorize("hasPermission(#id, 'TASK', 'VIEW')")
  public Page<CommentService.ActivityView> activity(
      @PathVariable UUID id,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Integer limit) {
    return service.activity(id, cursor, limit);
  }
}
