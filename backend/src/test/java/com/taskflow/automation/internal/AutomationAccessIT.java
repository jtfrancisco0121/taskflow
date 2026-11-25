package com.taskflow.automation.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

@DisplayName("AD-8 what a rule may touch and who sees its runs")
@TestPropertySource(
    properties = {"taskflow.workers.enabled=true", "taskflow.outbox.amqp.enabled=true"})
class AutomationAccessIT extends EngineSupport {

  @Test
  void aMembersFolderRuleSkipsTasksInAPrivateChildListTheyCannotSee() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Eng");
    UUID folder = folder(ws.owner(), space, "Q1");
    UUID open = list(ws.owner(), folder, "Open");
    UUID secret = list(ws.owner(), folder, "Secret");
    assertThat(
            patch(
                    "/api/v1/locations/" + secret,
                    ws.owner().token(),
                    Map.of("isPrivate", true),
                    "If-Match",
                    "\"1\"")
                .status())
        .isLessThan(300);
    UUID rule =
        createRule(
            ws.member(), folder, body("Done", statusTo("complete"), List.of(comment("seen"))));
    UUID inOpen = task(ws.owner(), open, "Visible");
    UUID inSecret = task(ws.owner(), secret, "Hidden");
    moveTo(ws.owner(), open, inOpen, "complete");
    moveTo(ws.owner(), secret, inSecret, "complete");
    awaitRuns(rule, 2);
    pause(500);
    assertThat(run(rule, inOpen).get("status")).isEqualTo("SUCCEEDED");
    assertThat(run(rule, inSecret).get("status")).isEqualTo("SKIPPED");
    assertThat(run(rule, inSecret).get("reason")).isEqualTo("no_access");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM comment WHERE task_id = ?", Integer.class, inSecret))
        .isZero();

    // the member never sees the run on the private task, an admin does
    Resp memberRuns = get("/api/v1/automations/" + rule + "/runs", ws.member().token());
    assertThat(memberRuns.status()).isEqualTo(200);
    assertThat(memberRuns.at("/items")).hasSize(1);
    assertThat(memberRuns.text("/items/0/taskId")).isEqualTo(inOpen.toString());
    Resp adminRuns = get("/api/v1/automations/" + rule + "/runs", ws.admin().token());
    assertThat(adminRuns.at("/items")).hasSize(2);
    Resp ruleForMember = get("/api/v1/locations/" + folder + "/automations", ws.member().token());
    assertThat(ruleForMember.text("/rules/0/lastRun/taskId")).isEqualTo(inOpen.toString());
    Resp ruleForAdmin = get("/api/v1/locations/" + folder + "/automations", ws.admin().token());
    assertThat(ruleForAdmin.text("/rules/0/lastRun/status")).isIn("SUCCEEDED", "SKIPPED");
  }

  @Test
  void runHistoryPagesWithAKeysetCursorNewestFirst() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Eng");
    UUID list = list(ws.owner(), space, "Backlog");
    UUID rule =
        createRule(
            ws.owner(),
            space,
            body("Created", Map.of("type", "TASK_CREATED"), List.of(comment("hi"))));
    for (int i = 0; i < 5; i++) {
      task(ws.owner(), list, "T" + i);
    }
    awaitRuns(rule, 5);
    Resp first = get("/api/v1/automations/" + rule + "/runs?limit=2", ws.owner().token());
    assertThat(first.at("/items")).hasSize(2);
    String cursor = first.text("/nextCursor");
    Resp second =
        get("/api/v1/automations/" + rule + "/runs?limit=2&cursor=" + cursor, ws.owner().token());
    assertThat(second.at("/items")).hasSize(2);
    assertThat(second.text("/items/0/id")).isNotEqualTo(first.text("/items/1/id"));
    assertThat(first.text("/items/0/createdAt").compareTo(second.text("/items/0/createdAt")))
        .isGreaterThanOrEqualTo(0);
    assertThat(get("/api/v1/automations/" + rule + "/runs", ws.guest().token()).status())
        .isEqualTo(404);
  }
}
