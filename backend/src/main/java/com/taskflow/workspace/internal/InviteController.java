package com.taskflow.workspace.internal;

import com.taskflow.shared.Idempotent;
import com.taskflow.shared.Page;
import com.taskflow.workspace.Role;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
class InviteController {

  record CreateInviteRequest(@NotBlank @Email @Size(max = 254) String email, @NotNull Role role) {}

  private final InviteService service;

  InviteController(InviteService service) {
    this.service = service;
  }

  @Idempotent
  @PostMapping("/workspaces/{id}/invites")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'MANAGE')")
  public ResponseEntity<InviteService.InviteView> create(
      @PathVariable UUID id, @Valid @RequestBody CreateInviteRequest request) {
    return ResponseEntity.status(HttpStatus.CREATED)
        .body(service.create(id, request.email(), request.role()));
  }

  @GetMapping("/workspaces/{id}/invites")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'MANAGE')")
  public Page<InviteService.InviteView> list(
      @PathVariable UUID id,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Integer limit) {
    return service.list(id, cursor, limit);
  }

  @DeleteMapping("/workspaces/{id}/invites/{inviteId}")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'MANAGE')")
  public ResponseEntity<Void> revoke(@PathVariable UUID id, @PathVariable UUID inviteId) {
    service.revoke(id, inviteId);
    return ResponseEntity.noContent().build();
  }

  /** Public: the invite page shows who invited you before you sign in. */
  @GetMapping("/invites/{token}")
  public InviteService.InvitePreview preview(@PathVariable String token) {
    return service.preview(token);
  }

  @PostMapping("/invites/{token}/accept")
  public InviteService.Accepted accept(@PathVariable String token) {
    return service.accept(token);
  }
}
