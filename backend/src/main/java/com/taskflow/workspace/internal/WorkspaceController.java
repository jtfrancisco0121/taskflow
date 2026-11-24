package com.taskflow.workspace.internal;

import com.taskflow.shared.Idempotent;
import com.taskflow.shared.Page;
import com.taskflow.workspace.Role;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
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
@RequestMapping("/api/v1/workspaces")
class WorkspaceController {

  record CreateWorkspaceRequest(
      @NotBlank @Size(max = 100) String name,
      @Pattern(regexp = "^[A-Z]{2,6}$", message = "must be 2 to 6 uppercase letters") String key) {}

  record RenameWorkspaceRequest(@NotBlank @Size(max = 100) String name) {}

  record ChangeRoleRequest(@NotNull Role role) {}

  private final WorkspaceService service;

  WorkspaceController(WorkspaceService service) {
    this.service = service;
  }

  @Idempotent
  @PostMapping
  public ResponseEntity<WorkspaceService.WorkspaceView> create(
      @Valid @RequestBody CreateWorkspaceRequest request) {
    WorkspaceService.WorkspaceView created = service.create(request.name(), request.key());
    return ResponseEntity.status(HttpStatus.CREATED)
        .header("Location", "/api/v1/workspaces/" + created.id())
        .body(created);
  }

  @GetMapping
  public Page<WorkspaceService.WorkspaceView> list(
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Integer limit) {
    return service.list(cursor, limit);
  }

  @GetMapping("/{id}")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'VIEW')")
  public WorkspaceService.WorkspaceView get(@PathVariable UUID id) {
    return service.get(id);
  }

  @PatchMapping("/{id}")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'EDIT')")
  public WorkspaceService.WorkspaceView rename(
      @PathVariable UUID id, @Valid @RequestBody RenameWorkspaceRequest request) {
    return service.rename(id, request.name());
  }

  @DeleteMapping("/{id}")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'DELETE')")
  public ResponseEntity<Void> delete(@PathVariable UUID id) {
    service.delete(id);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/{id}/members")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'VIEW')")
  public Page<WorkspaceService.MemberView> members(
      @PathVariable UUID id,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Integer limit) {
    return service.members(id, cursor, limit);
  }

  @PatchMapping("/{id}/members/{userId}")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'MANAGE')")
  public WorkspaceService.MemberView changeRole(
      @PathVariable UUID id,
      @PathVariable UUID userId,
      @Valid @RequestBody ChangeRoleRequest request) {
    return service.changeRole(id, userId, request.role());
  }

  @DeleteMapping("/{id}/members/{userId}")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'MANAGE')")
  public ResponseEntity<Void> removeMember(@PathVariable UUID id, @PathVariable UUID userId) {
    service.remove(id, userId);
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/{id}/leave")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'VIEW')")
  public ResponseEntity<Void> leave(@PathVariable UUID id) {
    service.leave(id);
    return ResponseEntity.noContent().build();
  }
}
