package com.taskflow.automation.internal;

import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.Page;
import com.taskflow.shared.PageCursor;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.LocationAccess;
import com.taskflow.workspace.Role;
import com.taskflow.workspace.WorkspaceQuery;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The run history of a rule (CAP-5, FR-12). Needs VIEW on the rule's Location, and lists only runs
 * whose task's home List the viewer can see, in the query so that paging stays correct (AD-8).
 */
@RestController
@RequestMapping("/api/v1")
class AutomationRunController {

  record RunView(
      UUID id,
      UUID taskId,
      String taskReadableId,
      String taskTitle,
      String status,
      String reason,
      String error,
      boolean retryable,
      int attempt,
      int depth,
      Instant createdAt,
      Instant updatedAt) {}

  private final NamedParameterJdbcTemplate named;
  private final WorkspaceQuery workspaces;
  private final AutomationRuleService rules;

  AutomationRunController(
      NamedParameterJdbcTemplate named, WorkspaceQuery workspaces, AutomationRuleService rules) {
    this.named = named;
    this.workspaces = workspaces;
    this.rules = rules;
  }

  @GetMapping("/automations/{id}/runs")
  @PreAuthorize("hasPermission(#id, 'AUTOMATION', 'VIEW')")
  @Transactional(readOnly = true)
  public Page<RunView> runs(
      @PathVariable UUID id,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) Integer limit) {
    AutomationRuleService.Row rule = rules.live(id);
    int size = PageCursor.limit(limit);
    UUID uid = CurrentActor.userId();
    Role role =
        workspaces
            .roleOf(rule.workspaceId(), uid)
            .orElseThrow(
                () -> TaskflowException.notFound("automation.not_found", "Automation not found"));
    List<String> after = PageCursor.decode(cursor, 2);
    MapSqlParameterSource params =
        new MapSqlParameterSource(LocationAccess.params(uid, role))
            .addValue("rule", id)
            .addValue("n", size + 1);
    String keyset = "";
    if (after != null) {
      keyset = " AND (r.created_at, r.id) < (:at, :after)";
      params
          .addValue("at", Timestamp.from(Instant.parse(after.get(0))))
          .addValue("after", PageCursor.uuid(after.get(1)));
    }
    List<RunView> rows =
        named.query(
            "SELECT r.id, r.task_id, w.key || '-' || t.number AS readable, t.title, r.status,"
                + " r.reason, r.error, r.retryable, r.attempt, r.depth, r.created_at, r.updated_at"
                + " FROM automation_run r JOIN task t ON t.workspace_id = r.workspace_id AND t.id ="
                + " r.task_id JOIN workspace w ON w.id = t.workspace_id JOIN location l ON"
                + " l.workspace_id = t.workspace_id AND l.id = t.list_id WHERE r.rule_id = :rule AND "
                + LocationAccess.visible("l")
                + keyset
                + " ORDER BY r.created_at DESC, r.id DESC LIMIT :n",
            params,
            (rs, i) ->
                new RunView(
                    rs.getObject("id", UUID.class),
                    rs.getObject("task_id", UUID.class),
                    rs.getString("readable"),
                    rs.getString("title"),
                    rs.getString("status"),
                    rs.getString("reason"),
                    rs.getString("error"),
                    rs.getBoolean("retryable"),
                    rs.getInt("attempt"),
                    rs.getInt("depth"),
                    rs.getTimestamp("created_at").toInstant(),
                    rs.getTimestamp("updated_at").toInstant()));
    return PageCursor.page(
        rows, size, r -> PageCursor.encode(r.createdAt().toString(), r.id().toString()));
  }
}
