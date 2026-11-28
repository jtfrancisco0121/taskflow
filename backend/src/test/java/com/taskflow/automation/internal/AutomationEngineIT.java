package com.taskflow.automation.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.notification.internal.WorkersIntegrationTest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("CAP-2, CAP-4, CAP-5 rule engine")
@WorkersIntegrationTest
class AutomationEngineIT extends EngineSupport {

  private record Fx(Ws ws, UUID space, UUID list, UUID task) {}

  private Fx fx() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Eng");
    UUID list = list(ws.owner(), space, "Backlog");
    return new Fx(ws, space, list, task(ws.owner(), list, "Ship it"));
  }

  @Test
  void aStatusChangeStartsTheMatchingRuleOnceAndNoOtherRule() {
    Fx f = fx();
    UUID match =
        createRule(
            f.ws().owner(),
            f.space(),
            body("Done", statusTo("complete"), List.of(comment("done!"))));
    UUID other =
        createRule(
            f.ws().owner(),
            f.space(),
            body("Doing", statusTo("in progress"), List.of(comment("hm"))));

    assertThat(moveTo(f.ws().owner(), f.list(), f.task(), "complete").status()).isEqualTo(200);
    awaitRuns(match, 1);
    pause(1500);
    assertThat(runs(match)).isEqualTo(1);
    assertThat(runs(other)).isZero();
    assertThat(run(match, f.task()).get("status")).isEqualTo("SUCCEEDED");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM comment WHERE task_id = ?", Integer.class, f.task()))
        .isEqualTo(1);
  }

  @Test
  void aStatusAndTitlePatchStartsAStatusRuleOnce() {
    Fx f = fx();
    UUID rule =
        createRule(
            f.ws().owner(), f.space(), body("Done", statusTo("complete"), List.of(comment("x"))));
    Resp r =
        patchTask(
            f.ws().owner(),
            f.task(),
            1,
            Map.of("title", "Renamed", "statusId", statusId(f.ws().owner(), f.list(), "complete")));
    assertThat(r.status()).isEqualTo(200);
    awaitRuns(rule, 1);
    pause(1500);
    assertThat(runs(rule)).isEqualTo(1);
  }

  @Test
  void taskCreatedAndAssigneeChangedTriggersRunOnce() {
    Fx f = fx();
    UUID created =
        createRule(
            f.ws().owner(),
            f.space(),
            body(
                "New",
                Map.of("type", "TASK_CREATED"),
                List.of(Map.of("type", "SET_PRIORITY", "priority", "HIGH"))));
    UUID assigned =
        createRule(
            f.ws().owner(),
            f.space(),
            body(
                "Assigned",
                Map.of("type", "ASSIGNEE_CHANGED", "personId", f.ws().member().id()),
                List.of(comment("welcome"))));
    UUID newTask = task(f.ws().owner(), f.list(), "Fresh");
    awaitRuns(created, 1);
    await(
        () -> get("/api/v1/tasks/" + newTask, f.ws().owner().token()).text("/priority"),
        "HIGH"::equals);

    patchTask(f.ws().owner(), f.task(), 1, Map.of("assigneeIds", List.of(f.ws().admin().id())));
    pause(1500);
    assertThat(runs(assigned)).isZero();
    patchTask(
        f.ws().owner(),
        f.task(),
        2,
        Map.of("assigneeIds", List.of(f.ws().admin().id(), f.ws().member().id())));
    awaitRuns(assigned, 1);
    // rules are evaluated when the event is consumed, so the task made before the rule may also
    // match
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM automation_run WHERE rule_id = ? AND task_id = ?",
                Integer.class,
                created,
                newTask))
        .isEqualTo(1);
  }

  @Test
  void aCustomFieldChangeStartsTheRuleForThatField() {
    Fx f = fx();
    Resp field =
        post(
            "/api/v1/locations/" + f.space() + "/fields",
            f.ws().owner().token(),
            Map.of("name", "Points", "type", "NUMBER"));
    assertThat(field.status()).isEqualTo(201);
    UUID fieldId = field.uuid("/id");
    UUID rule =
        createRule(
            f.ws().owner(),
            f.space(),
            body(
                "Points",
                Map.of("type", "CUSTOM_FIELD_CHANGED", "fieldId", fieldId),
                List.of(comment("pts"))));
    patchTask(f.ws().owner(), f.task(), 1, Map.of("customFields", Map.of(fieldId.toString(), 5)));
    awaitRuns(rule, 1);
    pause(1000);
    assertThat(runs(rule)).isEqualTo(1);
  }

  @Test
  void everyActionTypeChangesTheTaskThroughTheTaskCommands() {
    Fx f = fx();
    UUID rule =
        createRule(
            f.ws().owner(),
            f.space(),
            body(
                "All",
                statusTo("in progress"),
                List.of(
                    Map.of("type", "ASSIGN", "personIds", List.of(f.ws().member().id())),
                    Map.of("type", "SET_PRIORITY", "priority", "URGENT"),
                    Map.of("type", "SET_DUE_DATE", "daysAfter", 3),
                    comment("on it"),
                    Map.of("type", "CREATE_SUBTASK", "title", "Plan"),
                    Map.of("type", "CHANGE_STATUS", "status", "complete"),
                    Map.of(
                        "type",
                        "SEND_NOTIFICATION",
                        "recipients",
                        List.of("ASSIGNEES"),
                        "message",
                        "hello"))));
    moveTo(f.ws().owner(), f.list(), f.task(), "in progress");
    awaitRuns(rule, 1);
    await(() -> run(rule, f.task()).get("status"), s -> !"SUCCEEDED".equals(s) || true);
    pause(500);
    Map<String, Object> run = run(rule, f.task());
    assertThat(run.get("status")).as(String.valueOf(run)).isEqualTo("SUCCEEDED");
    Resp task = get("/api/v1/tasks/" + f.task(), f.ws().owner().token());
    assertThat(task.at("/assigneeIds").get(0).asText()).isEqualTo(f.ws().member().id().toString());
    assertThat(task.text("/priority")).isEqualTo("URGENT");
    assertThat(task.text("/statusId"))
        .isEqualTo(statusId(f.ws().owner(), f.list(), "complete").toString());
    assertThat(Instant.parse(task.text("/dueDate")))
        .isAfter(Instant.now().plus(2, ChronoUnit.DAYS));
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM comment WHERE task_id = ?", Integer.class, f.task()))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM task WHERE parent_task_id = ?", Integer.class, f.task()))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE entity_id = ? AND type ="
                    + " 'automation.notify_requested'",
                Integer.class,
                rule))
        .isEqualTo(1);
    // every change is attributed to the rule in the activity feed
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM activity_event WHERE entity_id = ? AND actor_type ="
                    + " 'AUTOMATION' AND actor_id = ?",
                Integer.class,
                f.task(),
                rule))
        .isGreaterThanOrEqualTo(4);
  }

  @Test
  void aRefusedActionLeavesTheTaskUnchangedAndOneFailedRunWithoutRetry() {
    Fx f = fx();
    UUID rule =
        createRule(
            f.ws().owner(),
            f.space(),
            body(
                "Assign gone",
                statusTo("complete"),
                List.of(
                    comment("never"),
                    Map.of("type", "ASSIGN", "personIds", List.of(f.ws().guest().id())))));
    jdbc.update(
        "DELETE FROM workspace_member WHERE workspace_id = ? AND user_id = ?",
        f.ws().id(),
        f.ws().guest().id());
    UUID second =
        createRule(
            f.ws().owner(),
            f.space(),
            body("Second", statusTo("complete"), List.of(comment("ok"))));
    moveTo(f.ws().owner(), f.list(), f.task(), "complete");
    awaitRuns(rule, 1);
    awaitRuns(second, 1);
    pause(1500);
    Map<String, Object> failed = run(rule, f.task());
    assertThat(failed.get("status")).isEqualTo("FAILED");
    assertThat(failed.get("retryable")).isEqualTo(false);
    assertThat(failed.get("attempt")).isEqualTo(1);
    assertThat(String.valueOf(failed.get("error"))).isNotBlank();
    assertThat(runs(rule)).isEqualTo(1);
    // the failing rule rolled back its comment; the other rule still ran
    assertThat(run(second, f.task()).get("status")).isEqualTo("SUCCEEDED");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM comment WHERE task_id = ?", Integer.class, f.task()))
        .isEqualTo(1);
  }

  @Test
  void falseConditionsSkipTheRunReadingTheCurrentTask() {
    Fx f = fx();
    UUID rule =
        createRule(
            f.ws().owner(),
            f.space(),
            body(
                "Urgent only",
                statusTo("complete"),
                List.of(
                    Map.of(
                        "type", "PRIORITY", "operator", "IS_ONE_OF", "values", List.of("URGENT"))),
                List.of(comment("x"))));
    moveTo(f.ws().owner(), f.list(), f.task(), "complete");
    awaitRuns(rule, 1);
    pause(500);
    assertThat(run(rule, f.task()).get("status")).isEqualTo("SKIPPED");
    assertThat(run(rule, f.task()).get("reason")).isEqualTo("conditions_not_met");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM comment WHERE task_id = ?", Integer.class, f.task()))
        .isZero();
  }

  @Test
  void aSpaceRuleFiresTwoLevelsDownButNotInAnotherSpaceAndNotWhenDisabled() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Eng");
    UUID deep = list(ws.owner(), folder(ws.owner(), space, "Q1"), "Deep");
    UUID elsewhereList = list(ws.owner(), space(ws.owner(), ws.id(), "Ops"), "Other");
    UUID rule =
        createRule(ws.owner(), space, body("Down", statusTo("complete"), List.of(comment("x"))));
    UUID disabled =
        createRule(ws.owner(), space, body("Off", statusTo("complete"), List.of(comment("y"))));
    patch(
        "/api/v1/automations/" + disabled,
        ws.owner().token(),
        Map.of("enabled", false),
        "If-Match",
        "\"1\"");
    UUID inDeep = task(ws.owner(), deep, "A");
    UUID inOps = task(ws.owner(), elsewhereList, "B");
    moveTo(ws.owner(), deep, inDeep, "complete");
    moveTo(ws.owner(), elsewhereList, inOps, "complete");
    awaitRuns(rule, 1);
    pause(1500);
    assertThat(runs(rule)).isEqualTo(1);
    assertThat(run(rule, inDeep).get("status")).isEqualTo("SUCCEEDED");
    assertThat(runs(disabled)).isZero();
  }

  @Test
  void aRedeliveredMessageLeavesOneSucceededRunAndOneSetOfChanges() {
    Fx f = fx();
    UUID rule =
        createRule(
            f.ws().owner(),
            f.space(),
            body("Done", statusTo("complete"), List.of(comment("once"))));
    moveTo(f.ws().owner(), f.list(), f.task(), "complete");
    awaitRuns(rule, 1);
    UUID eventId =
        jdbc.queryForObject(
            "SELECT id FROM outbox_event WHERE entity_id = ? AND type = 'task.status_changed'",
            UUID.class,
            f.task());
    await(
        () ->
            jdbc.queryForObject(
                "SELECT queued_at IS NOT NULL FROM outbox_event WHERE id = ?",
                Boolean.class,
                eventId),
        b -> b);
    jdbc.update(
        "UPDATE outbox_event SET queued_at = NULL, queue_claimed_until = NULL WHERE id = ?",
        eventId);
    await(
        () ->
            jdbc.queryForObject(
                "SELECT queued_at IS NOT NULL FROM outbox_event WHERE id = ?",
                Boolean.class,
                eventId),
        b -> b);
    pause(1500);
    assertThat(runs(rule)).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM comment WHERE task_id = ?", Integer.class, f.task()))
        .isEqualTo(1);
  }
}
