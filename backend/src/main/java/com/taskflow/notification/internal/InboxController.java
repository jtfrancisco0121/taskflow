package com.taskflow.notification.internal;

import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.Page;
import java.util.UUID;
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

/** The caller's inbox (CAP-11). */
@RestController
@RequestMapping("/api/v1")
class InboxController {

  record ReadAllRequest(UUID upToId) {}

  record ReadAllResult(long marked) {}

  private final InboxService inbox;

  InboxController(InboxService inbox) {
    this.inbox = inbox;
  }

  @GetMapping("/workspaces/{id}/notifications")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'VIEW')")
  public Page<InboxService.NotificationView> list(
      @PathVariable UUID id,
      @RequestParam(defaultValue = "false") boolean unread,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Integer limit) {
    return inbox.list(id, CurrentActor.userId(), unread, cursor, limit);
  }

  @GetMapping("/workspaces/{id}/notifications/unread-count")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'VIEW')")
  public InboxService.UnreadCount unreadCount(@PathVariable UUID id) {
    return inbox.unreadCount(id, CurrentActor.userId());
  }

  @PostMapping("/workspaces/{id}/notifications/read-all")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'VIEW')")
  public ReadAllResult readAll(
      @PathVariable UUID id, @RequestBody(required = false) ReadAllRequest request) {
    return new ReadAllResult(
        inbox.readAll(id, CurrentActor.userId(), request == null ? null : request.upToId()));
  }

  @PostMapping("/notifications/{id}/read")
  public ResponseEntity<Void> markRead(@PathVariable UUID id) {
    inbox.setRead(id, CurrentActor.userId(), true);
    return ResponseEntity.noContent().build();
  }

  @DeleteMapping("/notifications/{id}/read")
  public ResponseEntity<Void> markUnread(@PathVariable UUID id) {
    inbox.setRead(id, CurrentActor.userId(), false);
    return ResponseEntity.noContent().build();
  }
}
