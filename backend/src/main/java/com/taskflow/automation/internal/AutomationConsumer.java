package com.taskflow.automation.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.automation.internal.RuleDocs.Action;
import com.taskflow.automation.internal.RuleDocs.Condition;
import com.taskflow.automation.internal.RuleDocs.Trigger;
import com.taskflow.shared.EventQueues;
import com.taskflow.shared.Ids;
import com.taskflow.shared.TaskflowException;
import com.taskflow.shared.TransientFailures;
import com.taskflow.shared.TransientMessageException;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Runs the rules a task event triggers (CAP-2, CAP-5). Every matching rule runs in its own
 * transaction, so one failing rule never rolls back or blocks another; a failure is written after
 * that transaction has rolled back (AD-4). The method itself is not transactional.
 */
@Component
@ConditionalOnProperty(
    name = "taskflow.workers.enabled",
    havingValue = "true",
    matchIfMissing = true)
class AutomationConsumer {

  static final String QUEUE = "taskflow.automation";
  static final Set<String> TYPES =
      Set.of(
          "task.created",
          "task.updated",
          "task.status_changed",
          "task.due_soon",
          "task.due_reached");

  private static final Logger log = LoggerFactory.getLogger(AutomationConsumer.class);

  private final ObjectMapper mapper;
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final TransactionTemplate failureTx;
  private final TriggerMatcher matcher;
  private final AutomationRuleRunner runner;
  private final MeterRegistry meters;

  AutomationConsumer(
      ObjectMapper mapper,
      JdbcTemplate jdbc,
      TransactionTemplate tx,
      TriggerMatcher matcher,
      AutomationRuleRunner runner,
      MeterRegistry meters) {
    this.mapper = mapper;
    this.jdbc = jdbc;
    this.tx = tx;
    this.failureTx = new TransactionTemplate(tx.getTransactionManager());
    this.matcher = matcher;
    this.runner = runner;
    this.meters = meters;
  }

  @RabbitListener(
      queues = QUEUE,
      containerFactory = EventQueues.LISTENER_FACTORY,
      concurrency = "${taskflow.automation.consumers:4}")
  public void onMessage(Message message) throws JsonProcessingException {
    JsonNode envelope = mapper.readTree(new String(message.getBody(), StandardCharsets.UTF_8));
    String type = envelope.path("type").asText();
    if (!TYPES.contains(type)) {
      return;
    }
    EngineEvent event = EngineEvent.parse(envelope);
    boolean transientFailure = false;
    for (AutomationRuleRunner.LoadedRule rule : candidates(event)) {
      if (!matcher.matches(rule.trigger(), event)) {
        continue;
      }
      long started = System.nanoTime();
      try {
        AutomationRuleRunner.Outcome outcome = tx.execute(status -> runner.execute(rule, event));
        record(
            rule, event, outcome == null ? "noop" : outcome.status().toLowerCase(), started, null);
        if (outcome != null && !outcome.status().equals("NOOP")) {
          log.info(
              "automation run eventId={} ruleId={} taskId={} outcome={} reason={}",
              event.id(),
              rule.id(),
              event.taskId(),
              outcome.status(),
              outcome.reason());
        }
      } catch (RuntimeException e) {
        boolean retryable = isRetryable(e);
        // The rule's transaction has rolled back; the failure is recorded in a new one (AD-4).
        recordFailure(rule, event, e, retryable);
        record(rule, event, "failed", started, e);
        transientFailure |= retryable;
      }
    }
    if (transientFailure) {
      throw new TransientMessageException("a rule failed transiently for event " + event.id());
    }
  }

  private void record(
      AutomationRuleRunner.LoadedRule rule,
      EngineEvent event,
      String outcome,
      long startedNanos,
      Throwable error) {
    meters.counter("taskflow.automation.runs", "outcome", outcome).increment();
    Timer.builder("taskflow.automation.rule.duration")
        .register(meters)
        .record(System.nanoTime() - startedNanos, TimeUnit.NANOSECONDS);
    if (error != null) {
      log.warn(
          "automation run failed eventId={} ruleId={} taskId={}: {}",
          event.id(),
          rule.id(),
          event.taskId(),
          error.toString());
    }
  }

  /** A refused action is terminal; a 409, a data access or a broker error is worth another try. */
  static boolean isRetryable(RuntimeException e) {
    for (Throwable t = e; t != null; t = t.getCause()) {
      if (t instanceof TaskflowException te) {
        int status = te.status().value();
        return status == 409 || status >= 500;
      }
      if (t.getCause() == t) {
        break;
      }
    }
    return TransientFailures.isTransient(e);
  }

  private void recordFailure(
      AutomationRuleRunner.LoadedRule rule,
      EngineEvent event,
      RuntimeException e,
      boolean retryable) {
    String text = String.valueOf(e.getMessage());
    String error = text.length() > 500 ? text.substring(0, 499) + "…" : text;
    failureTx.executeWithoutResult(status -> {
      jdbc.execute("SET LOCAL lock_timeout = '2s'");
      jdbc.update(
          "INSERT INTO automation_run (id, workspace_id, rule_id, task_id, event_id, status,"
              + " error, retryable, attempt, depth) VALUES (?, ?, ?, ?, ?, 'FAILED', ?, ?, 1,"
              + " ?) ON CONFLICT (rule_id, event_id) DO UPDATE SET status = 'FAILED',"
              + " retryable = EXCLUDED.retryable, error = EXCLUDED.error, attempt ="
              + " automation_run.attempt + 1, updated_at = now() WHERE automation_run.status ="
              + " 'FAILED' AND automation_run.retryable",
          Ids.newId(),
          rule.row().workspaceId(),
          rule.id(),
          event.taskId(),
          event.id(),
          error,
          retryable,
          event.depth() + 1);
    });
  }

  /** Enabled, live rules whose Location is at or above the task's home List. */
  private List<AutomationRuleRunner.LoadedRule> candidates(EngineEvent event) {
    List<AutomationRuleService.Row> rows =
        jdbc.query(
            "SELECT r.* FROM automation_rule r JOIN location rl ON rl.workspace_id ="
                + " r.workspace_id AND rl.id = r.location_id JOIN task t ON t.workspace_id ="
                + " r.workspace_id AND t.id = ? JOIN location l ON l.workspace_id = t.workspace_id"
                + " AND l.id = t.list_id WHERE r.workspace_id = ? AND r.deleted_at IS NULL AND"
                + " r.enabled AND t.deleted_at IS NULL AND rl.path @> l.path ORDER BY r.created_at,"
                + " r.id",
            (rs, i) -> AutomationRuleService.row(rs),
            event.taskId(),
            event.workspaceId());
    List<AutomationRuleRunner.LoadedRule> out = new ArrayList<>();
    for (AutomationRuleService.Row r : rows) {
      try {
        out.add(
            new AutomationRuleRunner.LoadedRule(
                r,
                mapper.readValue(r.trigger(), Trigger.class),
                mapper.readValue(r.conditions(), new TypeReference<List<Condition>>() {}),
                mapper.readValue(r.actions(), new TypeReference<List<Action>>() {})));
      } catch (JsonProcessingException e) {
        log.error("rule {} has an unreadable document, skipped: {}", r.id(), e.toString());
      }
    }
    return out;
  }
}
