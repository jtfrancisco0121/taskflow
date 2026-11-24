package com.taskflow.notification.internal;

import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.TaskflowException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The caller's notification preferences in one Workspace (CAP-13). */
@RestController
@RequestMapping("/api/v1")
class PreferenceController {

  record PreferenceItem(
      @NotBlank String kind, @NotNull Boolean inApp, @NotNull Boolean emailDigest) {}

  record PreferencesRequest(@NotNull List<@Valid PreferenceItem> kinds) {}

  record PreferencesView(List<PreferenceStore.Preference> kinds) {}

  private final PreferenceStore store;

  PreferenceController(PreferenceStore store) {
    this.store = store;
  }

  @GetMapping("/workspaces/{id}/notification-preferences")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'VIEW')")
  public PreferencesView get(@PathVariable UUID id) {
    return new PreferencesView(store.all(id, CurrentActor.userId()));
  }

  @PutMapping("/workspaces/{id}/notification-preferences")
  @PreAuthorize("hasPermission(#id, 'WORKSPACE', 'VIEW')")
  @Transactional
  public PreferencesView put(
      @PathVariable UUID id, @Valid @RequestBody PreferencesRequest request) {
    UUID me = CurrentActor.userId();
    for (PreferenceItem item : request.kinds()) {
      if (!PreferenceStore.KINDS.contains(item.kind())) {
        throw TaskflowException.badRequest(
            "notification.invalid_kind", "Unknown notification kind " + item.kind());
      }
      store.save(
          id, me, new PreferenceStore.Preference(item.kind(), item.inApp(), item.emailDigest()));
    }
    return new PreferencesView(store.all(id, me));
  }
}
