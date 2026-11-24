package com.taskflow.view.internal;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.taskflow.shared.Idempotent;
import com.taskflow.view.ViewConfig;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
@JsonInclude(JsonInclude.Include.ALWAYS)
class ViewController {

  record CreateViewRequest(
      UUID workspaceId,
      UUID locationId,
      String name,
      @NotNull String type,
      String visibility,
      String defaultKind,
      @NotNull ViewConfig config,
      List<UUID> shareWith) {}

  record UpdateViewRequest(
      String name, String visibility, ViewConfig config, List<UUID> shareWith) {}

  private final ViewService service;

  ViewController(ViewService service) {
    this.service = service;
  }

  @GetMapping("/locations/{id}/views")
  public ViewService.ViewList forLocation(@PathVariable UUID id) {
    return service.forLocation(id);
  }

  @GetMapping("/workspaces/{id}/views")
  public ViewService.ViewList forWorkspace(@PathVariable UUID id) {
    return service.forWorkspace(id);
  }

  @Idempotent
  @PostMapping("/views")
  public ResponseEntity<ViewService.ViewDto> create(
      @RequestBody @jakarta.validation.Valid CreateViewRequest request) {
    ViewService.ViewDto view =
        service.create(
            new ViewService.CreateInput(
                request.workspaceId(),
                request.locationId(),
                request.name(),
                request.type(),
                request.visibility(),
                request.defaultKind(),
                request.config(),
                request.shareWith()));
    return ResponseEntity.status(HttpStatus.CREATED)
        .header("Location", "/api/v1/views/" + view.id())
        .body(view);
  }

  @GetMapping("/views/{id}")
  public ViewService.ViewDto get(@PathVariable UUID id) {
    return service.get(id);
  }

  @PatchMapping("/views/{id}")
  public ViewService.ViewDto update(@PathVariable UUID id, @RequestBody UpdateViewRequest request) {
    return service.update(
        id,
        new ViewService.UpdateInput(
            request.name(), request.visibility(), request.config(), request.shareWith()));
  }

  @DeleteMapping("/views/{id}")
  public ResponseEntity<Void> delete(@PathVariable UUID id) {
    service.delete(id);
    return ResponseEntity.noContent().build();
  }
}
