package com.taskflow.workspace.internal;

import com.taskflow.shared.Page;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/locations/{id}/grants")
class GrantController {

  private final GrantService service;

  GrantController(GrantService service) {
    this.service = service;
  }

  @GetMapping
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'MANAGE')")
  public Page<GrantService.GrantView> list(
      @PathVariable UUID id,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Integer limit) {
    return service.list(id, cursor, limit);
  }

  @PutMapping("/{userId}")
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'MANAGE')")
  public ResponseEntity<Void> grant(@PathVariable UUID id, @PathVariable UUID userId) {
    service.grant(id, userId);
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/{userId}")
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'MANAGE')")
  public ResponseEntity<Void> revoke(@PathVariable UUID id, @PathVariable UUID userId) {
    service.revoke(id, userId);
    return ResponseEntity.noContent().build();
  }
}
