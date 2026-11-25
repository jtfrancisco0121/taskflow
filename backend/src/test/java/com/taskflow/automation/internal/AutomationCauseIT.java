package com.taskflow.automation.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.taskflow.IntegrationTest;
import com.taskflow.identity.AutomationAuthors;
import com.taskflow.shared.Actor;
import com.taskflow.shared.AutomationCause;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.TaskflowException;
import com.taskflow.task.Priority;
import com.taskflow.task.TaskCommands;
import com.taskflow.workspace.Role;
import com.taskflow.workspace.WorkspaceQuery;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

@DisplayName("CAP-4, CAP-7 automation cause, actor and author")
class AutomationCauseIT extends IntegrationTest {

  @Autowired TaskCommands commands;
  @Autowired AutomationAuthors authors;
  @Autowired WorkspaceQuery workspaces;
  @Autowired EventRecorder events;
  @Autowired TransactionTemplate tx;

  private record Fixture(Ws ws, UUID list, UUID task) {}

  private Fixture fixture() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.owner(), space(ws.owner(), ws.id(), "Eng"), "Backlog");
    return new Fixture(ws, list, task(ws.owner(), list, "Ship it"));
  }

  private void asRule(Fixture f, UUID rule, int depth, Runnable body) {
    AutomationCause cause =
        new AutomationCause(f.ws().id(), rule, "Done to QA", UUID.randomUUID(), depth);
    tx.executeWithoutResult(s -> AutomationCause.run(cause, body));
  }

  @Test
  void changesMadeInsideARunCarryTheCauseAndTheRuleAsActor() {
    Fixture f = fixture();
    UUID rule = UUID.randomUUID();
    asRule(f, rule, 1, () -> commands.setStatus(f.task(), 1, "complete"));

    Map<String, Object> outbox =
        jdbc.queryForMap(
            "SELECT actor_type, actor_id, payload->'automation'->>'ruleName' AS name,"
                + " (payload->'automation'->>'depth')::int AS depth FROM outbox_event WHERE"
                + " entity_id = ? AND type = 'task.status_changed'",
            f.task());
    assertThat(outbox.get("actor_type")).isEqualTo("AUTOMATION");
    assertThat(outbox.get("actor_id")).isEqualTo(rule);
    assertThat(outbox.get("name")).isEqualTo("Done to QA");
    assertThat(outbox.get("depth")).isEqualTo(1);
    Map<String, Object> activity =
        jdbc.queryForMap(
            "SELECT actor_type, actor_id, payload->'automation'->>'ruleId' AS rule FROM"
                + " activity_event WHERE entity_id = ? AND type = 'task.status_changed'",
            f.task());
    assertThat(activity.get("actor_type")).isEqualTo("AUTOMATION");
    assertThat(activity.get("rule")).isEqualTo(rule.toString());

    // outside a run the next change has no cause
    patchTask(f.ws().owner(), f.task(), 2, Map.of("title", "Renamed"));
    assertThat(
            jdbc.queryForObject(
                "SELECT jsonb_exists(payload, 'automation') FROM outbox_event WHERE entity_id = ? AND type ="
                    + " 'task.updated'",
                Boolean.class,
                f.task()))
        .isFalse();
  }

  @Test
  void anAutomationIsAdminOnlyInTheWorkspaceOfItsCauseAndUnderItsOwnRuleId() {
    Fixture f = fixture();
    UUID rule = UUID.randomUUID();
    UUID other = createWorkspace(f.ws().owner(), "Elsewhere");
    asRule(
        f,
        rule,
        1,
        () -> {
          assertThat(workspaces.roleOf(f.ws().id(), rule)).contains(Role.ADMIN);
          assertThat(workspaces.roleOf(other, rule)).isEmpty();
          assertThat(workspaces.roleOf(f.ws().id(), UUID.randomUUID())).isEmpty();
          assertThat(workspaces.roleOf(f.ws().id(), Actor.SYSTEM.id())).isEmpty();
          // an assignee keeps their own role
          assertThat(workspaces.roleOf(f.ws().id(), f.ws().member().id())).contains(Role.MEMBER);
        });
    assertThat(workspaces.roleOf(f.ws().id(), rule)).isEmpty();
  }

  @Test
  void aNonMemberAssigneeIsRefusedInsideARun() {
    Fixture f = fixture();
    TestUser stranger = signUp("Stranger");
    assertThatThrownBy(() ->
            asRule(
                f,
                UUID.randomUUID(),
                1,
                () -> commands.addAssignees(f.task(), 1, List.of(stranger.id()))))
        .isInstanceOf(TaskflowException.class);
    asRule(
        f,
        UUID.randomUUID(),
        1,
        () -> {
          var view = commands.addAssignees(f.task(), 1, List.of(f.ws().member().id()));
          assertThat(view.assigneeIds()).containsExactly(f.ws().member().id());
          assertThat(commands.setPriority(f.task(), view.version(), Priority.HIGH).priority())
              .isEqualTo(Priority.HIGH);
        });
  }

  @Test
  void commentsAndSubtasksAreAuthoredByTheWorkspacesAutomationUserThatCannotSignIn() {
    Fixture f = fixture();
    UUID rule = UUID.randomUUID();
    asRule(
        f,
        rule,
        1,
        () -> {
          commands.addComment(f.task(), "Looks good");
          commands.createSubtask(f.task(), "Follow up");
        });
    UUID author = authors.authorFor(f.ws().id());
    assertThat(
            jdbc.queryForObject(
                "SELECT author_id FROM comment WHERE task_id = ?", UUID.class, f.task()))
        .isEqualTo(author);
    assertThat(
            jdbc.queryForObject(
                "SELECT created_by FROM task WHERE parent_task_id = ?", UUID.class, f.task()))
        .isEqualTo(author);
    assertThat(jdbc.queryForObject("SELECT kind FROM app_user WHERE id = ?", String.class, author))
        .isEqualTo("AUTOMATION");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM workspace_member WHERE user_id = ?", Integer.class, author))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT email IS NULL AND password_hash IS NULL FROM app_user WHERE id = ?",
                Boolean.class,
                author))
        .isTrue();
    Resp comments = get("/api/v1/tasks/" + f.task() + "/comments", f.ws().owner().token());
    assertThat(comments.text("/items/0/authorName")).isEqualTo("Automation");
    assertThat(comments.at("/items/0/authorIsAutomation").asBoolean()).isTrue();
  }

  @Test
  void twoThreadsAskingForTheAuthorGetTheSameUser() throws Exception {
    Ws ws = workspaceWithAllRoles();
    CompletableFuture<UUID> a = CompletableFuture.supplyAsync(() -> authors.authorFor(ws.id()));
    CompletableFuture<UUID> b = CompletableFuture.supplyAsync(() -> authors.authorFor(ws.id()));
    assertThat(a.get()).isEqualTo(b.get());
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM automation_author WHERE workspace_id = ?",
                Integer.class,
                ws.id()))
        .isEqualTo(1);
  }

  @Test
  void theActivityApiNamesTheRuleAndTreatsSystemEntriesAsTaflowNotARule() {
    Fixture f = fixture();
    UUID rule = UUID.randomUUID();
    asRule(f, rule, 1, () -> commands.setStatus(f.task(), 1, "complete"));
    tx.executeWithoutResult(s ->
        events.record(
            f.ws().id(),
            "task",
            f.task(),
            "task.due_reached",
            Map.of("version", 2, "listId", f.list().toString()),
            Actor.SYSTEM));

    Resp activity = get("/api/v1/tasks/" + f.task() + "/activity", f.ws().owner().token());
    assertThat(activity.status()).isEqualTo(200);
    var items = activity.at("/items");
    boolean sawRule = false;
    boolean sawSystem = false;
    for (var item : items) {
      if (item.get("type").asText().equals("task.status_changed")) {
        assertThat(item.get("actorType").asText()).isEqualTo("AUTOMATION");
        assertThat(item.get("automationRuleName").asText()).isEqualTo("Done to QA");
        assertThat(item.get("automationRuleId").asText()).isEqualTo(rule.toString());
        assertThat(item.get("actorName").asText()).isEqualTo("Done to QA");
        sawRule = true;
      }
      if (item.get("type").asText().equals("task.due_reached")) {
        assertThat(item.get("actorName").asText()).isEqualTo("Taskflow");
        assertThat(item.hasNonNull("automationRuleName")).isFalse();
        sawSystem = true;
      }
    }
    assertThat(sawRule).isTrue();
    assertThat(sawSystem).isTrue();
  }
}
