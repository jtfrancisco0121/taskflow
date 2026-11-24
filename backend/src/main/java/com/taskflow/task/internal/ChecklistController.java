package com.taskflow.task.internal;

import com.fasterxml.jackson.databind.node.ObjectNode;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.parameters.RequestBody;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
class ChecklistController {

  record CreateChecklistRequest(@NotBlank @Size(max = 200) String name) {}

  /** Merge patch: name, or beforeId/afterId to reorder. */
  record UpdateChecklistRequest(String name, UUID beforeId, UUID afterId) {}

  record CreateItemRequest(
      @NotBlank @Size(max = 1000) String text, UUID assigneeId, UUID beforeId, UUID afterId) {}

  /** Merge patch: text, checked, assigneeId (null clears), or beforeId/afterId to reorder. */
  record UpdateItemRequest(
      String text, Boolean checked, UUID assigneeId, UUID beforeId, UUID afterId) {}

  private final ChecklistService service;

  ChecklistController(ChecklistService service) {
    this.service = service;
  }

  @GetMapping("/tasks/{id}/checklists")
  @PreAuthorize("hasPermission(#id, 'TASK', 'VIEW')")
  public List<ChecklistService.ChecklistView> list(@PathVariable UUID id) {
    return service.list(id);
  }

  @PostMapping("/tasks/{id}/checklists")
  @PreAuthorize("hasPermission(#id, 'TASK', 'EDIT')")
  public ResponseEntity<ChecklistService.ChecklistView> create(
      @PathVariable UUID id,
      @Valid @org.springframework.web.bind.annotation.RequestBody CreateChecklistRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED).body(service.create(id, request.name()));
  }

  @PatchMapping("/checklists/{id}")
  @PreAuthorize("hasPermission(#id, 'CHECKLIST', 'EDIT')")
  @RequestBody(content = @Content(schema = @Schema(implementation = UpdateChecklistRequest.class)))
  public ChecklistService.ChecklistView update(
      @PathVariable UUID id,
      @org.springframework.web.bind.annotation.RequestBody ObjectNode patch) {
    return service.update(id, patch);
  }

  @DeleteMapping("/checklists/{id}")
  @PreAuthorize("hasPermission(#id, 'CHECKLIST', 'EDIT')")
  public ResponseEntity<Void> delete(@PathVariable UUID id) {
    service.delete(id);
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/checklists/{id}/items")
  @PreAuthorize("hasPermission(#id, 'CHECKLIST', 'EDIT')")
  public ResponseEntity<ChecklistService.ChecklistView> addItem(
      @PathVariable UUID id,
      @Valid @org.springframework.web.bind.annotation.RequestBody CreateItemRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(
            service.addItem(
                id, request.text(), request.assigneeId(), request.beforeId(), request.afterId()));
  }

  @PatchMapping("/checklist-items/{id}")
  @PreAuthorize("hasPermission(#id, 'CHECKLIST_ITEM', 'EDIT')")
  @RequestBody(content = @Content(schema = @Schema(implementation = UpdateItemRequest.class)))
  public ChecklistService.ChecklistView updateItem(
      @PathVariable UUID id,
      @org.springframework.web.bind.annotation.RequestBody ObjectNode patch) {
    return service.updateItem(id, patch);
  }

  @DeleteMapping("/checklist-items/{id}")
  @PreAuthorize("hasPermission(#id, 'CHECKLIST_ITEM', 'EDIT')")
  public ResponseEntity<Void> deleteItem(@PathVariable UUID id) {
    service.deleteItem(id);
    return ResponseEntity.noContent().build();
  }
}
