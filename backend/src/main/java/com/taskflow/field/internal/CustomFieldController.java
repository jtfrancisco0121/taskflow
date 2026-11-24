package com.taskflow.field.internal;

import com.taskflow.shared.Idempotent;
import com.taskflow.shared.TaskflowException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Custom field definitions (AD-9). Values are written through the task endpoints. */
@RestController
@RequestMapping("/api/v1")
class CustomFieldController {

  record OptionRequest(UUID id, @NotBlank @Size(max = 50) String name, String color) {}

  record CreateFieldRequest(
      @NotBlank @Size(max = 50) String name,
      @NotNull String type,
      Map<String, Object> config,
      List<@Valid OptionRequest> options) {}

  /** Merge patch: an absent member is untouched; {@code options} is the full ordered list. */
  record UpdateFieldRequest(
      @Size(max = 50) String name,
      String type,
      Map<String, Object> config,
      List<@Valid OptionRequest> options,
      UUID beforeId,
      UUID afterId) {}

  private final CustomFieldService service;

  CustomFieldController(CustomFieldService service) {
    this.service = service;
  }

  @GetMapping("/locations/{id}/fields")
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'VIEW')")
  public CustomFieldService.FieldListView list(@PathVariable UUID id) {
    return service.list(id);
  }

  @Idempotent
  @PostMapping("/locations/{id}/fields")
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'EDIT')")
  public ResponseEntity<CustomFieldService.FieldView> create(
      @PathVariable UUID id, @Valid @RequestBody CreateFieldRequest request) {
    CustomFieldService.FieldView created =
        service.create(
            id,
            new CustomFieldService.CreateInput(
                request.name(), request.type(), request.config(), drafts(request.options())));
    return etag(
        ResponseEntity.status(HttpStatus.CREATED)
            .header(HttpHeaders.LOCATION, "/api/v1/fields/" + created.id()),
        created);
  }

  @GetMapping("/fields/{id}")
  @PreAuthorize("hasPermission(#id, 'FIELD', 'VIEW')")
  public ResponseEntity<CustomFieldService.FieldView> get(@PathVariable UUID id) {
    return etag(ResponseEntity.ok(), service.get(id));
  }

  @PatchMapping("/fields/{id}")
  @PreAuthorize("hasPermission(#id, 'FIELD', 'VIEW')")
  public ResponseEntity<CustomFieldService.FieldView> update(
      @PathVariable UUID id,
      @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
      @Valid @RequestBody UpdateFieldRequest request) {
    return etag(
        ResponseEntity.ok(),
        service.update(
            id,
            version(ifMatch),
            new CustomFieldService.UpdateInput(
                request.name(),
                request.type(),
                request.config(),
                request.options() == null ? null : drafts(request.options()),
                request.beforeId(),
                request.afterId())));
  }

  /** Retires the field: its values stay stored, nothing shows them. */
  @DeleteMapping("/fields/{id}")
  @PreAuthorize("hasPermission(#id, 'FIELD', 'VIEW')")
  public ResponseEntity<Void> retire(
      @PathVariable UUID id,
      @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch) {
    service.retire(id, version(ifMatch));
    return ResponseEntity.noContent().build();
  }

  @PutMapping("/locations/{id}/fields/{fieldId}/hidden")
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'EDIT')")
  public CustomFieldService.FieldListView hide(@PathVariable UUID id, @PathVariable UUID fieldId) {
    return service.hide(id, fieldId);
  }

  @DeleteMapping("/locations/{id}/fields/{fieldId}/hidden")
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'EDIT')")
  public CustomFieldService.FieldListView unhide(
      @PathVariable UUID id, @PathVariable UUID fieldId) {
    return service.unhide(id, fieldId);
  }

  private static List<CustomFieldService.OptionDraft> drafts(List<OptionRequest> options) {
    return options == null
        ? List.of()
        : options.stream()
            .map(o -> new CustomFieldService.OptionDraft(o.id(), o.name(), o.color()))
            .toList();
  }

  private static ResponseEntity<CustomFieldService.FieldView> etag(
      ResponseEntity.BodyBuilder builder, CustomFieldService.FieldView field) {
    return builder.header(HttpHeaders.ETAG, "\"" + field.version() + "\"").body(field);
  }

  /** Parses {@code If-Match}: the field version, quoted, weak or bare. */
  static long version(String ifMatch) {
    if (ifMatch == null || ifMatch.isBlank()) {
      throw new TaskflowException(
          HttpStatus.PRECONDITION_REQUIRED,
          "field.if_match_required",
          "Send the field's ETag in If-Match");
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
          "field.invalid_if_match", "If-Match must be a field version");
    }
  }
}
