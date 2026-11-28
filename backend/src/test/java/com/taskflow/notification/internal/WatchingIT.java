package com.taskflow.notification.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("CAP-10 watching")
@WorkersIntegrationTest
class WatchingIT extends NotificationSupport {

  @Test
  void creatingATaskWatchesItAndTheControlTogglesIt() {
    Fx f = fx();
    UUID task = taskFor(f.ws().member(), f.list(), "T");
    await(() -> watching(task, f.ws().member().id()), b -> b);
    Resp view = get("/api/v1/tasks/" + task + "/watchers", f.ws().member().token());
    assertThat(view.at("/watching").asBoolean()).isTrue();
    assertThat(view.at("/count").asInt()).isEqualTo(1);
    assertThat(view.text("/items/0/displayName")).isEqualTo("Member");
    Resp off = delete("/api/v1/tasks/" + task + "/watch", f.ws().member().token());
    assertThat(off.at("/watching").asBoolean()).isFalse();
    assertThat(off.at("/count").asInt()).isZero();
    assertThat(
            put("/api/v1/tasks/" + task + "/watch", f.ws().admin().token(), null)
                .at("/count")
                .asInt())
        .isEqualTo(1);
  }

  @Test
  void anUnwatchSticksUntilANewAssignmentOrMentionAndStopsCommentedUntilWatchedAgain() {
    Fx f = fx();
    UUID task = taskFor(f.ws().owner(), f.list(), "T", f.ws().member().id());
    await(() -> watching(task, f.ws().member().id()), b -> b);
    delete("/api/v1/tasks/" + task + "/watch", f.ws().member().token());
    comment(f.ws().admin(), task, "one");
    pause(1500);
    assertThat(count(f.ws().member().id(), task, "COMMENTED")).isZero();
    // commenting yourself is an automatic watch, which does not undo an explicit unwatch
    comment(f.ws().member(), task, "mine");
    pause(1000);
    assertThat(watching(task, f.ws().member().id())).isFalse();
    // watching again makes the next comment count
    put("/api/v1/tasks/" + task + "/watch", f.ws().member().token(), null);
    comment(f.ws().admin(), task, "two");
    awaitKind(f.ws().member().id(), task, "COMMENTED");
    // an unwatch is undone by a new mention
    delete("/api/v1/tasks/" + task + "/watch", f.ws().member().token());
    comment(f.ws().admin(), task, "ping", f.ws().member().id());
    awaitKind(f.ws().member().id(), task, "MENTIONED");
    await(() -> watching(task, f.ws().member().id()), b -> b);
  }

  @Test
  void aNewAssignmentWatchesAgainAfterAnUnwatch() {
    Fx f = fx();
    UUID task = taskFor(f.ws().owner(), f.list(), "T", f.ws().member().id());
    await(() -> watching(task, f.ws().member().id()), b -> b);
    delete("/api/v1/tasks/" + task + "/watch", f.ws().member().token());
    long v = get("/api/v1/tasks/" + task, f.ws().owner().token()).at("/version").asLong();
    patchTask(f.ws().owner(), task, v, Map.of("assigneeIds", List.of(f.ws().admin().id())));
    awaitKind(f.ws().admin().id(), task, "ASSIGNED");
    v = get("/api/v1/tasks/" + task, f.ws().owner().token()).at("/version").asLong();
    patchTask(
        f.ws().owner(),
        task,
        v,
        Map.of("assigneeIds", List.of(f.ws().admin().id(), f.ws().member().id())));
    await(() -> count(f.ws().member().id(), task, "ASSIGNED"), n -> n >= 2);
    await(() -> watching(task, f.ws().member().id()), b -> b);
  }

  @Test
  void aSelfAssignmentWatchesTheActorSoALaterCommentNotifiesThem() {
    Fx f = fx();
    UUID task2 = taskFor(f.ws().owner(), f.list(), "T2");
    long v2 = get("/api/v1/tasks/" + task2, f.ws().member().token()).at("/version").asLong();
    patchTask(f.ws().member(), task2, v2, Map.of("assigneeIds", List.of(f.ws().member().id())));
    await(() -> watching(task2, f.ws().member().id()), b -> b);
    comment(f.ws().admin(), task2, "hello");
    awaitKind(f.ws().member().id(), task2, "COMMENTED");
  }

  @Test
  void ruleMadeAndServiceAccountEventsAddNoWatcherForTheirActorButStillNotify() {
    Fx f = fx();
    Agent agent = agent(f.ws().owner(), f.ws().id());
    var body =
        Map.of(
            "name", "Subtask and comment",
            "trigger", Map.of("type", "TASK_CREATED"),
            "actions",
                List.of(
                    Map.of("type", "CREATE_SUBTASK", "title", "Plan"),
                    Map.of("type", "ADD_COMMENT", "text", "welcome", "personIds", List.of())));
    assertThat(
            post("/api/v1/locations/" + f.space() + "/automations", f.ws().owner().token(), body)
                .status())
        .isEqualTo(201);
    Resp t =
        post(
            "/api/v1/lists/" + f.list() + "/tasks",
            agent.secret(),
            Map.of("title", "By agent", "assigneeIds", List.of(f.ws().member().id())));
    UUID task = t.uuid("/id");
    awaitKind(f.ws().member().id(), task, "ASSIGNED");
    await(
        () ->
            jdbc.queryForObject("SELECT count(*) FROM comment WHERE task_id = ?", Long.class, task),
        n -> n >= 1);
    pause(1500);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM task_watcher w JOIN app_user u ON u.id = w.user_id WHERE"
                    + " u.kind <> 'HUMAN'",
                Long.class))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM task_watcher WHERE user_id = ?", Long.class, agent.id()))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE type = 'notification.created' AND"
                    + " (payload->>'workspaceId') = ?",
                Long.class,
                f.ws().id().toString()))
        .isGreaterThanOrEqualTo(1);
  }
}
