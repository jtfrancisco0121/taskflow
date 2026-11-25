package com.taskflow.automation.internal;

import com.taskflow.automation.internal.RuleDocs.Action;
import com.taskflow.automation.internal.RuleDocs.Condition;
import com.taskflow.automation.internal.RuleDocs.Trigger;
import com.taskflow.shared.Idempotent;
import com.taskflow.shared.TaskflowException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
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
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Automation rules at a Location (CAP-1). */
@RestController
@RequestMapping("/api/v1")
class AutomationController {

  record CreateRuleRequest(
      @NotBlank @Size(max = 100) String name,
      Boolean enabled,
      @NotNull Trigger trigger,
      List<Condition> conditions,
      @NotNull List<Action> actions) {}

  /** Merge patch: an absent member is untouched; {@code enabled} switches the rule on or off. */
  record UpdateRuleRequest(
      @Size(max = 100) String name,
      Boolean enabled,
      Trigger trigger,
      List<Condition> conditions,
      List<Action> actions) {}

  private final AutomationRuleService service;

  AutomationController(AutomationRuleService service) {
    this.service = service;
  }

  @GetMapping("/locations/{id}/automations")
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'VIEW')")
  public AutomationRuleService.RuleListView list(@PathVariable UUID id) {
    return service.list(id);
  }

  @Idempotent
  @PostMapping("/locations/{id}/automations")
  @PreAuthorize("hasPermission(#id, 'LOCATION', 'VIEW')")
  public ResponseEntity<AutomationRuleService.RuleView> create(
      @PathVariable UUID id, @Valid @RequestBody CreateRuleRequest request) {
    AutomationRuleService.RuleView created =
        service.create(
            id,
            new AutomationRuleService.CreateInput(
                request.name(),
                request.enabled(),
                request.trigger(),
                request.conditions(),
                request.actions()));
    return etag(
        ResponseEntity.status(HttpStatus.CREATED)
            .header(HttpHeaders.LOCATION, "/api/v1/automations/" + created.id()),
        created);
  }

  @GetMapping("/automations/{id}")
  @PreAuthorize("hasPermission(#id, 'AUTOMATION', 'VIEW')")
  public ResponseEntity<AutomationRuleService.RuleView> get(@PathVariable UUID id) {
    return etag(ResponseEntity.ok(), service.get(id));
  }

  @PatchMapping("/automations/{id}")
  @PreAuthorize("hasPermission(#id, 'AUTOMATION', 'VIEW')")
  public ResponseEntity<AutomationRuleService.RuleView> update(
      @PathVariable UUID id,
      @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
      @Valid @RequestBody UpdateRuleRequest request) {
    return etag(
        ResponseEntity.ok(),
        service.update(
            id,
            version(ifMatch),
            new AutomationRuleService.UpdateInput(
                request.name(),
                request.enabled(),
                request.trigger(),
                request.conditions(),
                request.actions())));
  }

  @DeleteMapping("/automations/{id}")
  @PreAuthorize("hasPermission(#id, 'AUTOMATION', 'VIEW')")
  public ResponseEntity<Void> delete(
      @PathVariable UUID id,
      @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch) {
    service.delete(id, ifMatch == null || ifMatch.isBlank() ? null : version(ifMatch));
    return ResponseEntity.noContent().build();
  }

  private static ResponseEntity<AutomationRuleService.RuleView> etag(
      ResponseEntity.BodyBuilder builder, AutomationRuleService.RuleView rule) {
    return builder.header(HttpHeaders.ETAG, "\"" + rule.version() + "\"").body(rule);
  }

  /** Parses {@code If-Match}: the rule version, quoted, weak or bare. */
  static long version(String ifMatch) {
    if (ifMatch == null || ifMatch.isBlank()) {
      throw new TaskflowException(
          HttpStatus.PRECONDITION_REQUIRED,
          "automation.if_match_required",
          "Send the rule's ETag in If-Match");
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
          "automation.invalid_if_match", "If-Match must be a rule version");
    }
  }
}
