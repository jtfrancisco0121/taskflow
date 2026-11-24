package com.taskflow.identity.internal;

import com.taskflow.shared.Idempotent;
import com.taskflow.shared.Page;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
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
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Service account and key management: Workspace owners and admins (people) only. */
@RestController
@RequestMapping("/api/v1/workspaces/{workspaceId}/service-accounts")
class ServiceAccountController {

  record NameRequest(@NotBlank @Size(max = 100) String name) {}

  record CreateKeyRequest(@NotBlank @Size(max = 100) String name, Instant expiresAt) {}

  private static final String MANAGE = "hasPermission(#workspaceId, 'WORKSPACE', 'MANAGE')";

  private final ServiceAccountService accounts;
  private final ApiKeyService keys;
  private final ServiceAccountAuditService audit;

  ServiceAccountController(
      ServiceAccountService accounts, ApiKeyService keys, ServiceAccountAuditService audit) {
    this.accounts = accounts;
    this.keys = keys;
    this.audit = audit;
  }

  @GetMapping
  @PreAuthorize(MANAGE)
  public Page<ServiceAccountService.ServiceAccountView> list(
      @PathVariable UUID workspaceId,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Integer limit) {
    return accounts.list(workspaceId, cursor, limit);
  }

  @Idempotent
  @PostMapping
  @PreAuthorize(MANAGE)
  public ResponseEntity<ServiceAccountService.ServiceAccountView> create(
      @PathVariable UUID workspaceId, @Valid @RequestBody NameRequest request) {
    ServiceAccountService.ServiceAccountView created = accounts.create(workspaceId, request.name());
    return ResponseEntity.status(HttpStatus.CREATED)
        .header(
            "Location", "/api/v1/workspaces/" + workspaceId + "/service-accounts/" + created.id())
        .body(created);
  }

  @GetMapping("/{id}")
  @PreAuthorize(MANAGE)
  public ServiceAccountService.ServiceAccountView get(
      @PathVariable UUID workspaceId, @PathVariable UUID id) {
    return accounts.get(workspaceId, id);
  }

  @PatchMapping("/{id}")
  @PreAuthorize(MANAGE)
  public ServiceAccountService.ServiceAccountView rename(
      @PathVariable UUID workspaceId,
      @PathVariable UUID id,
      @Valid @RequestBody NameRequest request) {
    return accounts.rename(workspaceId, id, request.name());
  }

  @PostMapping("/{id}/disable")
  @PreAuthorize(MANAGE)
  public ServiceAccountService.ServiceAccountView disable(
      @PathVariable UUID workspaceId, @PathVariable UUID id) {
    return accounts.disable(workspaceId, id);
  }

  @PostMapping("/{id}/enable")
  @PreAuthorize(MANAGE)
  public ServiceAccountService.ServiceAccountView enable(
      @PathVariable UUID workspaceId, @PathVariable UUID id) {
    return accounts.enable(workspaceId, id);
  }

  @GetMapping("/{id}/api-keys")
  @PreAuthorize(MANAGE)
  public List<ApiKeyService.ApiKeyView> listKeys(
      @PathVariable UUID workspaceId, @PathVariable UUID id) {
    return keys.list(workspaceId, id);
  }

  @PostMapping("/{id}/api-keys")
  @PreAuthorize(MANAGE)
  public ResponseEntity<ApiKeyService.CreatedApiKey> createKey(
      @PathVariable UUID workspaceId,
      @PathVariable UUID id,
      @Valid @RequestBody CreateKeyRequest request) {
    ApiKeyService.CreatedApiKey created =
        keys.create(workspaceId, id, request.name(), request.expiresAt());
    // The secret must not be stored by any cache.
    return ResponseEntity.status(HttpStatus.CREATED)
        .header("Cache-Control", "no-store")
        .body(created);
  }

  @GetMapping("/{id}/audit")
  @PreAuthorize(MANAGE)
  public ServiceAccountAuditService.Audit audit(
      @PathVariable UUID workspaceId, @PathVariable UUID id) {
    return audit.audit(workspaceId, id);
  }

  @GetMapping("/{id}/activity")
  @PreAuthorize(MANAGE)
  public Page<ServiceAccountAuditService.AccountActivity> activity(
      @PathVariable UUID workspaceId,
      @PathVariable UUID id,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Integer limit) {
    return audit.activity(workspaceId, id, cursor, limit);
  }

  @DeleteMapping("/{id}/api-keys/{keyId}")
  @PreAuthorize(MANAGE)
  public ResponseEntity<Void> revokeKey(
      @PathVariable UUID workspaceId, @PathVariable UUID id, @PathVariable UUID keyId) {
    keys.revoke(workspaceId, id, keyId);
    return ResponseEntity.noContent().build();
  }
}
