package com.taskflow.field.internal;

import com.taskflow.field.StatusGroup;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/locations/{id}/statuses")
class StatusController {

  record StatusRequest(
      UUID id, @NotBlank @Size(max = 50) String name, @NotNull StatusGroup group, String color) {}

  record RemapRequest(@NotNull UUID from, @NotBlank String to) {}

  record ReplaceStatusesRequest(
      @NotNull @Size(min = 1, max = 30) List<@Valid StatusRequest> statuses,
      List<@Valid RemapRequest> remap) {}

  record ResetStatusesRequest(List<@Valid RemapRequest> remap) {}

  private final StatusService service;

  StatusController(StatusService service) {
    this.service = service;
  }

  @GetMapping
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'VIEW')")
  public StatusService.StatusSetView get(@PathVariable UUID id) {
    return service.get(id);
  }

  @PutMapping
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'EDIT')")
  public StatusService.StatusSetView replace(
      @PathVariable UUID id, @Valid @RequestBody ReplaceStatusesRequest request) {
    return service.replace(
        id,
        request.statuses().stream()
            .map(s -> new StatusService.StatusDraft(s.id(), s.name(), s.group(), s.color()))
            .toList(),
        remaps(request.remap()));
  }

  /** Resets to inherit; the optional body carries the remap for the removed statuses. */
  @DeleteMapping
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'EDIT')")
  public StatusService.StatusSetView reset(
      @PathVariable UUID id, @RequestBody(required = false) @Valid ResetStatusesRequest request) {
    return service.reset(id, remaps(request == null ? null : request.remap()));
  }

  private static List<StatusService.Remap> remaps(List<RemapRequest> remap) {
    return remap == null
        ? List.of()
        : remap.stream().map(r -> new StatusService.Remap(r.from(), r.to())).toList();
  }
}
