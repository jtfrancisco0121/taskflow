package com.taskflow.notification.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.shared.Actor;
import com.taskflow.shared.EventRecorder;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.support.TransactionTemplate;

@DisplayName("CAP-9 notification kinds and recipients")
@TestPropertySource(
    properties = {"taskflow.workers.enabled=true", "taskflow.outbox.amqp.enabled=true"})
class NotificationKindsIT extends NotificationSupport {

  @Autowired EventRecorder events;
  @Autowired TransactionTemplate tx;

  @Test
  void anAssignmentNotifiesTheAssigneeNotTheActor() {
    Fx f = fx();
    UUID task = taskFor(f.ws().owner(), f.list(), "T", f.ws().member().id(), f.ws().owner().id());
    awaitKind(f.ws().member().id(), task, "ASSIGNED");
    pause(800);
    assertThat(kinds(f.ws().member().id(), task)).containsExactly("ASSIGNED");
    assertThat(kinds(f.ws().owner().id(), task)).isEmpty();
    // a later assignment on update notifies the added person only
    long v = get("/api/v1/tasks/" + task, f.ws().owner().token()).at("/version").asLong();
    patchTask(
        f.ws().owner(),
        task,
        v,
        Map.of("assigneeIds", List.of(f.ws().member().id(), f.ws().admin().id())));
    awaitKind(f.ws().admin().id(), task, "ASSIGNED");
    assertThat(count(f.ws().member().id(), task, "ASSIGNED")).isEqualTo(1);
  }

  @Test
  void aMentionNotifiesOncePerCommentEvenWhenTheEditKeepsIt() {
    Fx f = fx();
    UUID task = taskFor(f.ws().owner(), f.list(), "T");
    Resp c = comment(f.ws().member(), task, "look", f.ws().admin().id());
    assertThat(c.status()).isEqualTo(201);
    awaitKind(f.ws().admin().id(), task, "MENTIONED");
    Resp edit =
        patch(
            "/api/v1/comments/" + c.uuid("/id"),
            f.ws().member().token(),
            Map.of("body", doc(mapper, "look again", f.ws().admin().id())));
    assertThat(edit.status()).isEqualTo(200);
    pause(1500);
    assertThat(count(f.ws().admin().id(), task, "MENTIONED")).isEqualTo(1);
    assertThat(kinds(f.ws().member().id(), task)).isEmpty();
  }

  @Test
  void aMentionedWatcherGetsOnlyTheMentionedNotification() {
    Fx f = fx();
    UUID task = taskFor(f.ws().owner(), f.list(), "T", f.ws().admin().id());
    awaitKind(f.ws().admin().id(), task, "ASSIGNED");
    comment(f.ws().member(), task, "hey", f.ws().admin().id());
    awaitKind(f.ws().admin().id(), task, "MENTIONED");
    pause(1000);
    assertThat(count(f.ws().admin().id(), task, "COMMENTED")).isZero();
  }

  @Test
  void watchersGetCommentedAndStatusChangedButNotTheActor() {
    Fx f = fx();
    UUID task = taskFor(f.ws().owner(), f.list(), "T", f.ws().member().id());
    awaitKind(f.ws().member().id(), task, "ASSIGNED");
    await(() -> watching(task, f.ws().member().id()), b -> b);
    comment(f.ws().admin(), task, "fyi");
    awaitKind(f.ws().member().id(), task, "COMMENTED");
    long v = get("/api/v1/tasks/" + task, f.ws().owner().token()).at("/version").asLong();
    String complete = null;
    for (var s :
        get("/api/v1/locations/" + f.list() + "/statuses", f.ws().owner().token())
            .at("/statuses")) {
      if (s.get("name").asText().equals("complete")) {
        complete = s.get("id").asText();
      }
    }
    patchTask(f.ws().owner(), task, v, Map.of("statusId", complete));
    awaitKind(f.ws().member().id(), task, "STATUS_CHANGED");
    // the owner created the task so watches it, but made the change; the admin commented so watches
    // too
    assertThat(count(f.ws().owner().id(), task, "STATUS_CHANGED")).isZero();
    assertThat(count(f.ws().admin().id(), task, "STATUS_CHANGED")).isEqualTo(1);
    assertThat(count(f.ws().admin().id(), task, "COMMENTED")).isZero();
  }

  @Test
  void dueSoonGoesToAssigneesAndBlockerResolvedOnlyWhenNothingElseBlocks() {
    Fx f = fx();
    UUID task = taskFor(f.ws().owner(), f.list(), "T", f.ws().member().id());
    awaitKind(f.ws().member().id(), task, "ASSIGNED");
    Map<String, Object> base = Map.of("version", 1, "listId", f.list().toString());
    tx.executeWithoutResult(
        s -> events.record(f.ws().id(), "task", task, "task.due_soon", base, Actor.SYSTEM));
    awaitKind(f.ws().member().id(), task, "DUE_SOON");
    tx.executeWithoutResult(s ->
        events.record(
            f.ws().id(),
            "task",
            task,
            "task.blocker_resolved",
            Map.of(
                "version",
                1,
                "listId",
                f.list().toString(),
                "blockerId",
                UUID.randomUUID().toString(),
                "stillBlocked",
                true),
            Actor.SYSTEM));
    pause(1200);
    assertThat(count(f.ws().member().id(), task, "BLOCKER_RESOLVED")).isZero();
    tx.executeWithoutResult(s ->
        events.record(
            f.ws().id(),
            "task",
            task,
            "task.blocker_resolved",
            Map.of(
                "version",
                1,
                "listId",
                f.list().toString(),
                "blockerId",
                UUID.randomUUID().toString(),
                "stillBlocked",
                false),
            Actor.SYSTEM));
    awaitKind(f.ws().member().id(), task, "BLOCKER_RESOLVED");
  }

  @Test
  void neverAServiceAccountOrSomeoneWhoCannotViewTheTask() {
    Fx f = fx();
    Agent agent = agent(f.ws().owner(), f.ws().id());
    // the guest holds no grant: the task is invisible to them
    UUID task = taskFor(f.ws().owner(), f.list(), "T", f.ws().member().id(), f.ws().guest().id());
    awaitKind(f.ws().member().id(), task, "ASSIGNED");
    pause(800);
    assertThat(kinds(f.ws().guest().id(), task)).isEmpty();
    // a service account is never a recipient, even when named
    tx.executeWithoutResult(s ->
        events.record(
            f.ws().id(),
            "automation",
            UUID.randomUUID(),
            "automation.notify_requested",
            Map.of(
                "taskId", task.toString(),
                "locationId", f.space().toString(),
                "ruleName", "R",
                "message", "hi",
                "recipients", List.of(),
                "personIds", List.of(agent.id().toString(), f.ws().admin().id().toString())),
            Actor.SYSTEM));
    awaitKind(f.ws().admin().id(), task, "AUTOMATION");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM notification WHERE recipient_id = ?", Long.class, agent.id()))
        .isZero();
    // the service account acts: the member is still told
    Resp t =
        post(
            "/api/v1/lists/" + f.list() + "/tasks",
            agent.secret(),
            Map.of("title", "By agent", "assigneeIds", List.of(f.ws().member().id())));
    assertThat(t.status()).isEqualTo(201);
    awaitKind(f.ws().member().id(), t.uuid("/id"), "ASSIGNED");
    assertThat(
            jdbc.queryForObject(
                "SELECT actor_type FROM notification WHERE task_id = ?",
                String.class,
                t.uuid("/id")))
        .isEqualTo("SERVICE_ACCOUNT");
  }

  @Test
  void aRulesSendNotificationActionNotifiesItsRecipientsEndToEnd() {
    Fx f = fx();
    var body =
        Map.of(
            "name", "Tell admin",
            "trigger", Map.of("type", "STATUS_CHANGED", "toStatuses", List.of("complete")),
            "actions",
                List.of(
                    Map.of(
                        "type", "SEND_NOTIFICATION",
                        "personIds", List.of(f.ws().admin().id()),
                        "message", "It is done")));
    assertThat(
            post("/api/v1/locations/" + f.space() + "/automations", f.ws().owner().token(), body)
                .status())
        .isEqualTo(201);
    UUID task = taskFor(f.ws().owner(), f.list(), "T");
    long v = get("/api/v1/tasks/" + task, f.ws().owner().token()).at("/version").asLong();
    String complete = null;
    for (var s :
        get("/api/v1/locations/" + f.list() + "/statuses", f.ws().owner().token())
            .at("/statuses")) {
      if (s.get("name").asText().equals("complete")) {
        complete = s.get("id").asText();
      }
    }
    patchTask(f.ws().owner(), task, v, Map.of("statusId", complete));
    awaitKind(f.ws().admin().id(), task, "AUTOMATION");
    Map<String, Object> row =
        jdbc.queryForMap(
            "SELECT rule_name, message, actor_type FROM notification WHERE recipient_id = ? AND kind = 'AUTOMATION'",
            f.ws().admin().id());
    assertThat(row.get("rule_name")).isEqualTo("Tell admin");
    assertThat(row.get("message")).isEqualTo("It is done");
    assertThat(row.get("actor_type")).isEqualTo("AUTOMATION");
  }
}
