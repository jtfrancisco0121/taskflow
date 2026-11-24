package com.taskflow.workspace.internal;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.taskflow.shared.Idempotent;
import com.taskflow.shared.Page;
import com.taskflow.workspace.LocationType;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
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
@RequestMapping("/api/v1")
@JsonInclude(JsonInclude.Include.NON_NULL)
class LocationController {

  record CreateLocationRequest(
      @NotNull LocationType type,
      UUID workspaceId,
      UUID parentId,
      @NotBlank @Size(max = 100) String name,
      Boolean isPrivate) {}

  record UpdateLocationRequest(@Size(min = 1, max = 100) String name, Boolean isPrivate) {}

  record MoveLocationRequest(UUID parentId, UUID beforeId, UUID afterId) {}

  private final LocationService service;

  LocationController(LocationService service) {
    this.service = service;
  }

  @Idempotent
  @PostMapping("/locations")
  public ResponseEntity<LocationService.LocationView> create(
      @Valid @RequestBody CreateLocationRequest request) {
    LocationService.LocationView created =
        service.create(
            request.type(),
            request.workspaceId(),
            request.parentId(),
            request.name(),
            Boolean.TRUE.equals(request.isPrivate()));
    return ResponseEntity.status(HttpStatus.CREATED)
        .header("Location", "/api/v1/locations/" + created.id())
        .body(created);
  }

  @GetMapping("/locations/{id}")
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'VIEW')")
  public LocationService.LocationView get(@PathVariable UUID id) {
    return service.get(id);
  }

  @PatchMapping("/locations/{id}")
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'EDIT')")
  public LocationService.LocationView update(
      @PathVariable UUID id, @Valid @RequestBody UpdateLocationRequest request) {
    return service.update(id, request.name(), request.isPrivate());
  }

  @PostMapping("/locations/{id}/move")
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'EDIT')")
  public LocationService.LocationView move(
      @PathVariable UUID id, @RequestBody MoveLocationRequest request) {
    return service.move(id, request.parentId(), request.beforeId(), request.afterId());
  }

  @PostMapping("/locations/{id}/archive")
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'EDIT')")
  public LocationService.LocationView archive(@PathVariable UUID id) {
    return service.archive(id);
  }

  @PostMapping("/locations/{id}/unarchive")
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'UNARCHIVE')")
  public LocationService.LocationView unarchive(@PathVariable UUID id) {
    return service.unarchive(id);
  }

  @DeleteMapping("/locations/{id}")
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'DELETE')")
  public ResponseEntity<Void> delete(@PathVariable UUID id) {
    service.delete(id);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/workspaces/{id}/tree")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'VIEW')")
  public Page<LocationService.TreeNode> tree(
      @PathVariable UUID id,
      @RequestParam(required = false) UUID parentId,
      @RequestParam(defaultValue = "false") boolean includeArchived) {
    return service.tree(id, parentId, includeArchived);
  }
}
