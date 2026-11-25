package com.taskflow.automation.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

@DisplayName("CAP-6 loop protection")
@TestPropertySource(
    properties = {"taskflow.workers.enabled=true", "taskflow.outbox.amqp.enabled=true"})
class AutomationLoopIT extends EngineSupport {

  private long skips(UUID rule, String reason) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM automation_run WHERE rule_id = ? AND reason = ?",
        Long.class,
        rule,
        reason);
  }

  @Test
  void twoRulesTogglingStatusStopAtDepthThree() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Eng");
    UUID list = list(ws.owner(), space, "Backlog");
    UUID a =
        createRule(
            ws.owner(),
            space,
            body(
                "A",
                statusTo("in progress"),
                List.of(Map.of("type", "CHANGE_STATUS", "status", "to do"))));
    UUID b =
        createRule(
            ws.owner(),
            space,
            body(
                "B",
                statusTo("to do"),
                List.of(Map.of("type", "CHANGE_STATUS", "status", "in progress"))));
    UUID task = task(ws.owner(), list, "Loop");
    // the task starts in "to do": moving it away and back is the outside change
    moveTo(ws.owner(), list, task, "in progress");
    await(
        () ->
            jdbc.queryForObject(
                "SELECT count(*) FROM automation_run WHERE task_id = ? AND reason = 'depth_limit'",
                Long.class,
                task),
        n -> n >= 1);
    pause(2000);
    long succeeded =
        jdbc.queryForObject(
            "SELECT count(*) FROM automation_run WHERE task_id = ? AND status = 'SUCCEEDED'",
            Long.class,
            task);
    assertThat(succeeded).isLessThanOrEqualTo(3);
    assertThat(skips(a, "depth_limit") + skips(b, "depth_limit")).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT max(depth) FROM automation_run WHERE task_id = ?", Integer.class, task))
        .isLessThanOrEqualTo(4);
  }

  @Test
  void aRuleNeverRunsOnItsOwnChange() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Eng");
    UUID list = list(ws.owner(), space, "Backlog");
    UUID rule =
        createRule(
            ws.owner(),
            space,
            body(
                "Add member",
                Map.of("type", "ASSIGNEE_CHANGED"),
                List.of(Map.of("type", "ASSIGN", "personIds", List.of(ws.member().id())))));
    UUID task = task(ws.owner(), list, "Self");
    pause(1500);
    long before = runs(rule);
    patchTask(ws.owner(), task, 1, Map.of("assigneeIds", List.of(ws.admin().id())));
    await(() -> runs(rule), n -> n >= before + 2);
    pause(1000);
    assertThat(skips(rule, "own_change")).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM automation_run WHERE rule_id = ? AND task_id = ? AND status ="
                    + " 'SUCCEEDED'",
                Long.class,
                rule,
                task))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM task_assignee WHERE task_id = ?", Integer.class, task))
        .isEqualTo(2);
  }

  @Test
  void theEleventhRunOfARuleOnATaskInTenMinutesIsStoppedByTheRunGuard() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Eng");
    UUID list = list(ws.owner(), space, "Backlog");
    UUID rule =
        createRule(
            ws.owner(),
            space,
            body("Any status", Map.of("type", "STATUS_CHANGED"), List.of(comment("seen"))));
    UUID task = task(ws.owner(), list, "Busy");
    for (int i = 0; i < 11; i++) {
      moveTo(ws.owner(), list, task, i % 2 == 0 ? "in progress" : "to do");
      awaitRuns(rule, i + 1);
    }
    await(() -> skips(rule, "run_guard"), n -> n >= 1);
    assertThat(skips(rule, "run_guard")).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM automation_run WHERE rule_id = ? AND status = 'SUCCEEDED'",
                Long.class,
                rule))
        .isEqualTo(10);
  }
}
