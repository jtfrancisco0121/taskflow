package com.taskflow.automation.internal;

import com.taskflow.automation.internal.RuleDocs.Action;
import com.taskflow.automation.internal.RuleDocs.Condition;
import com.taskflow.automation.internal.RuleDocs.Trigger;
import com.taskflow.shared.AutomationCause;
import com.taskflow.shared.Ids;
import com.taskflow.task.TaskReader;
import com.taskflow.task.TaskView;
import com.taskflow.workspace.LocationAccess;
import com.taskflow.workspace.Role;
import com.taskflow.workspace.WorkspaceQuery;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * One rule against one event, inside the caller's transaction (AD-3, AD-6, AD-8). The run row is
 * written first, so a redelivery is a no-op; skips and successes end the row in the same
 * transaction as the actions, so all actions of a run commit together or not at all. A failure
 * leaves by exception and rolls everything back; the consumer records it afterwards (AD-4).
 */
@Component
class AutomationRuleRunner {

  /** A rule with its documents parsed. */
  record LoadedRule(
      AutomationRuleService.Row row,
      Trigger trigger,
      List<Condition> conditions,
      List<Action> actions) {

    UUID id() {
      return row.id();
    }
  }

  /** {@code reason} is set for a skip. */
  record Outcome(String status, String reason) {
    static final Outcome NOOP = new Outcome("NOOP", null);
    static final Outcome SUCCEEDED = new Outcome("SUCCEEDED", null);

    static Outcome skipped(String reason) {
      return new Outcome("SKIPPED", reason);
    }
  }

  private final JdbcTemplate jdbc;
  private final NamedParameterJdbcTemplate named;
  private final WorkspaceQuery workspaces;
  private final TaskReader tasks;
  private final ConditionEvaluator conditions;
  private final ActionExecutor actions;
  private final int maxDepth;
  private final int runGuard;

  AutomationRuleRunner(
      JdbcTemplate jdbc,
      NamedParameterJdbcTemplate named,
      WorkspaceQuery workspaces,
      TaskReader tasks,
      ConditionEvaluator conditions,
      ActionExecutor actions,
      @Value("${taskflow.automation.max-depth:3}") int maxDepth,
      @Value("${taskflow.automation.run-guard:10}") int runGuard) {
    this.jdbc = jdbc;
    this.named = named;
    this.workspaces = workspaces;
    this.tasks = tasks;
    this.conditions = conditions;
    this.actions = actions;
    this.maxDepth = maxDepth;
    this.runGuard = runGuard;
  }

  Outcome execute(LoadedRule rule, EngineEvent event) {
    AutomationRuleService.Row row = rule.row();
    int runDepth = event.depth() + 1;
    // Never a caught unique violation: it would abort the transaction (AD-3).
    List<UUID> claimed =
        jdbc.query(
            "INSERT INTO automation_run (id, workspace_id, rule_id, task_id, event_id, status,"
                + " depth, attempt) VALUES (?, ?, ?, ?, ?, 'SUCCEEDED', ?, 1) ON CONFLICT"
                + " (rule_id, event_id) DO UPDATE SET attempt = automation_run.attempt + 1,"
                + " updated_at = now() WHERE automation_run.status = 'FAILED' AND"
                + " automation_run.retryable RETURNING id",
            (rs, i) -> rs.getObject(1, UUID.class),
            Ids.newId(),
            row.workspaceId(),
            row.id(),
            event.taskId(),
            event.id(),
            runDepth);
    if (claimed.isEmpty()) {
      return Outcome.NOOP;
    }
    UUID runId = claimed.get(0);

    // 1. Access (AD-8): nothing else about the task is read before this passes.
    String access = access(row, event.taskId());
    if (access != null) {
      return finish(runId, Outcome.skipped(access));
    }
    // 2. Loop guards, in order (AD-6).
    if (event.depth() >= maxDepth) {
      return finish(runId, Outcome.skipped("depth_limit"));
    }
    if (row.id().equals(event.causeRuleId())) {
      return finish(runId, Outcome.skipped("own_change"));
    }
    Integer recent =
        jdbc.queryForObject(
            "SELECT count(*) FROM automation_run WHERE rule_id = ? AND task_id = ? AND status IN"
                + " ('SUCCEEDED', 'FAILED') AND created_at > now() - interval '10 minutes' AND id"
                + " <> ?",
            Integer.class,
            row.id(),
            event.taskId(),
            runId);
    if (recent != null && recent >= runGuard) {
      return finish(runId, Outcome.skipped("run_guard"));
    }
    // 3. Still enabled, and the conditions against the task as it is now.
    Boolean enabled =
        jdbc.queryForObject(
            "SELECT enabled AND deleted_at IS NULL FROM automation_rule WHERE id = ?",
            Boolean.class,
            row.id());
    if (!Boolean.TRUE.equals(enabled)) {
      return finish(runId, Outcome.skipped("rule_disabled"));
    }
    List<TaskView> current = tasks.views(List.of(event.taskId()));
    if (current.isEmpty()) {
      return finish(runId, Outcome.skipped("out_of_scope"));
    }
    if (!conditions.holds(rule.conditions(), current.get(0))) {
      return finish(runId, Outcome.skipped("conditions_not_met"));
    }
    // 4. The actions, in order, as the rule (AD-5, AD-7).
    AutomationCause cause =
        new AutomationCause(row.workspaceId(), row.id(), row.name(), runId, runDepth);
    AutomationCause.run(
        cause,
        () -> {
          for (Action action : rule.actions()) {
            List<TaskView> now = tasks.views(List.of(event.taskId()));
            if (now.isEmpty()) {
              throw com.taskflow.shared.TaskflowException.notFound(
                  "task.not_found", "Task not found");
            }
            actions.execute(action, now.get(0), event, rule);
          }
        });
    return finish(runId, Outcome.SUCCEEDED);
  }

  private Outcome finish(UUID runId, Outcome outcome) {
    jdbc.update(
        "UPDATE automation_run SET status = ?, reason = ?, error = NULL, retryable = false,"
            + " updated_at = now() WHERE id = ?",
        outcome.status(),
        outcome.reason(),
        runId);
    return outcome;
  }

  /**
   * Null when the rule may act: the task's home List is at or below the rule's Location in its
   * Workspace, and the rule's creator, with their current role, can VIEW that List.
   */
  private String access(AutomationRuleService.Row row, UUID taskId) {
    Role role = workspaces.roleOf(row.workspaceId(), row.createdBy()).orElse(null);
    MapSqlParameterSource params =
        new MapSqlParameterSource(
            role == null
                ? Map.of("uid", row.createdBy(), "role", "GUEST")
                : LocationAccess.params(row.createdBy(), role));
    params
        .addValue("tid", taskId)
        .addValue("ws", row.workspaceId())
        .addValue("loc", row.locationId());
    List<boolean[]> found =
        named.query(
            "SELECT (rl.path @> l.path) AS in_scope, "
                + LocationAccess.visible("l")
                + " AS visible FROM task t JOIN location l ON l.workspace_id = t.workspace_id AND"
                + " l.id = t.list_id JOIN location rl ON rl.workspace_id = t.workspace_id AND rl.id"
                + " = :loc WHERE t.id = :tid AND t.workspace_id = :ws AND t.deleted_at IS NULL",
            params,
            (rs, i) -> new boolean[] {rs.getBoolean("in_scope"), rs.getBoolean("visible")});
    if (found.isEmpty() || !found.get(0)[0]) {
      return "out_of_scope";
    }
    if (role == null || !found.get(0)[1]) {
      return "no_access";
    }
    return null;
  }
}
