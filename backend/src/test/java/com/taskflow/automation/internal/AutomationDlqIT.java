package com.taskflow.automation.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.task.Priority;
import com.taskflow.task.TaskCommands;
import com.taskflow.task.TaskView;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.dao.TransientDataAccessResourceException;
import org.springframework.test.context.TestPropertySource;

@DisplayName("CAP-5 retries, dead-letter queue and failed runs")
@TestPropertySource(
    properties = {
      "taskflow.workers.enabled=true",
      "taskflow.outbox.amqp.enabled=true",
      "taskflow.test.dlq=true"
    })
@Import(AutomationDlqIT.FlakyCommands.class)
class AutomationDlqIT extends EngineSupport {

  /** Makes setStatus fail transiently for the tasks in {@link #FAILS}, a number of times each. */
  static final Map<UUID, AtomicInteger> FAILS = new ConcurrentHashMap<>();

  @TestConfiguration
  static class FlakyCommands {
    @Bean
    @Primary
    TaskCommands flakyCommands(@Qualifier("taskCommandsImpl") TaskCommands real) {
      return new TaskCommands() {
        @Override
        public TaskView setStatus(UUID taskId, long expectedVersion, String statusName) {
          AtomicInteger left = FAILS.get(taskId);
          if (left != null && left.getAndDecrement() > 0) {
            throw new TransientDataAccessResourceException("database blip");
          }
          return real.setStatus(taskId, expectedVersion, statusName);
        }

        @Override
        public TaskView addAssignees(UUID taskId, long v, List<UUID> personIds) {
          return real.addAssignees(taskId, v, personIds);
        }

        @Override
        public TaskView clearAssignees(UUID taskId, long v) {
          return real.clearAssignees(taskId, v);
        }

        @Override
        public TaskView setPriority(UUID taskId, long v, Priority priority) {
          return real.setPriority(taskId, v, priority);
        }

        @Override
        public TaskView setDueDate(UUID taskId, long v, Instant dueDate) {
          return real.setDueDate(taskId, v, dueDate);
        }

        @Override
        public void addComment(UUID taskId, String text) {
          real.addComment(taskId, text);
        }

        @Override
        public TaskView createSubtask(UUID parentTaskId, String title) {
          return real.createSubtask(parentTaskId, title);
        }
      };
    }
  }

  @Autowired RabbitTemplate rabbit;
  @Autowired MeterRegistry meters;

  @BeforeEach
  void reset() {
    FAILS.clear();
  }

  private record Fx(Ws ws, UUID space, UUID list, UUID task, UUID rule) {}

  private Fx fx() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Eng");
    UUID list = list(ws.owner(), space, "Backlog");
    UUID rule =
        createRule(
            ws.owner(),
            space,
            body(
                "Flaky",
                statusTo("in progress"),
                List.of(Map.of("type", "CHANGE_STATUS", "status", "complete"))));
    return new Fx(ws, space, list, task(ws.owner(), list, "T"), rule);
  }

  private UUID eventOf(UUID task) {
    return await(
            () ->
                jdbc.queryForList(
                    "SELECT id FROM outbox_event WHERE entity_id = ? AND type = 'task.status_changed'",
                    UUID.class,
                    task),
            l -> !l.isEmpty())
        .get(0);
  }

  private boolean onDlq(UUID eventId) {
    long deadline = System.currentTimeMillis() + 3000;
    while (System.currentTimeMillis() < deadline) {
      Message m = rabbit.receive("taskflow.automation.dlq", 200);
      if (m != null && eventId.toString().equals(m.getMessageProperties().getMessageId())) {
        return true;
      }
    }
    return false;
  }

  @Test
  void aTransientlyAlwaysFailingActionIsTriedThreeTimesThenDeadLettered() {
    Fx f = fx();
    FAILS.put(f.task(), new AtomicInteger(Integer.MAX_VALUE));
    moveTo(f.ws().owner(), f.list(), f.task(), "in progress");
    UUID event = eventOf(f.task());
    Map<String, Object> run =
        await(() -> run(f.rule(), f.task()), r -> Integer.valueOf(3).equals(r.get("attempt")));
    assertThat(run.get("status")).isEqualTo("FAILED");
    assertThat(run.get("retryable")).isEqualTo(true);
    assertThat(String.valueOf(run.get("error"))).contains("database blip");
    assertThat(runs(f.rule())).isEqualTo(1);
    assertThat(onDlq(event)).isTrue();
    // each attempt is fast: the FAILED row is written after the rule's transaction rolled back
    assertThat(
            meters
                .get("taskflow.automation.rule.duration")
                .timer()
                .max(java.util.concurrent.TimeUnit.SECONDS))
        .isLessThan(3.0);
  }

  @Test
  void aFailureThatClearsOnTheSecondAttemptEndsSucceededWithAttemptTwo() {
    Fx f = fx();
    FAILS.put(f.task(), new AtomicInteger(1));
    moveTo(f.ws().owner(), f.list(), f.task(), "in progress");
    Map<String, Object> run =
        await(() -> run(f.rule(), f.task()), r -> "SUCCEEDED".equals(r.get("status")));
    assertThat(run.get("attempt")).isEqualTo(2);
    assertThat(runs(f.rule())).isEqualTo(1);
  }

  @Test
  void aRefusedActionFailsOnceAndNeverReachesTheDeadLetterQueue() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Eng");
    UUID list = list(ws.owner(), space, "Backlog");
    UUID rule =
        createRule(
            ws.owner(),
            space,
            body(
                "Refused",
                statusTo("in progress"),
                List.of(Map.of("type", "ASSIGN", "personIds", List.of(ws.guest().id())))));
    jdbc.update(
        "DELETE FROM workspace_member WHERE workspace_id = ? AND user_id = ?",
        ws.id(),
        ws.guest().id());
    UUID task = task(ws.owner(), list, "T");
    moveTo(ws.owner(), list, task, "in progress");
    UUID event = eventOf(task);
    Map<String, Object> run = await(() -> run(rule, task), r -> "FAILED".equals(r.get("status")));
    assertThat(run.get("retryable")).isEqualTo(false);
    assertThat(run.get("attempt")).isEqualTo(1);
    assertThat(onDlq(event)).isFalse();
  }

  @Test
  void aRetryingRuleInOneWorkspaceDoesNotDelayAnotherWorkspace() {
    Fx a = fx();
    FAILS.put(a.task(), new AtomicInteger(Integer.MAX_VALUE));
    Ws other = workspaceWithAllRoles();
    UUID space = space(other.owner(), other.id(), "Eng");
    UUID list = list(other.owner(), space, "Backlog");
    UUID rule =
        createRule(
            other.owner(), space, body("Quick", statusTo("complete"), List.of(comment("fast"))));
    UUID task = task(other.owner(), list, "T");
    moveTo(a.ws().owner(), a.list(), a.task(), "in progress");
    long start = System.currentTimeMillis();
    moveTo(other.owner(), list, task, "complete");
    await(() -> runs(rule), n -> n >= 1);
    assertThat(System.currentTimeMillis() - start).isLessThan(4000);
    assertThat(run(rule, task).get("status")).isEqualTo("SUCCEEDED");
  }
}
