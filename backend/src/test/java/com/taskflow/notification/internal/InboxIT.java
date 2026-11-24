package com.taskflow.notification.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

@DisplayName("CAP-11 inbox")
@TestPropertySource(
    properties = {"taskflow.workers.enabled=true", "taskflow.outbox.amqp.enabled=true"})
class InboxIT extends NotificationSupport {

  private String base(Fx f) {
    return "/api/v1/workspaces/" + f.ws().id() + "/notifications";
  }

  private UUID assignedTasks(Fx f, int n) {
    UUID last = null;
    for (int i = 0; i < n; i++) {
      last = taskFor(f.ws().owner(), f.list(), "Task " + i, f.ws().member().id());
      awaitKind(f.ws().member().id(), last, "ASSIGNED");
    }
    return last;
  }

  @Test
  void theInboxPagesNewestFirstAndTheUnreadCountMatchesTheUnreadList() {
    Fx f = fx();
    assignedTasks(f, 5);
    String token = f.ws().member().token();
    Resp first = get(base(f) + "?limit=2", token);
    assertThat(first.status()).isEqualTo(200);
    assertThat(first.at("/items")).hasSize(2);
    assertThat(first.text("/items/0/kind")).isEqualTo("ASSIGNED");
    assertThat(first.text("/items/0/taskTitle")).isEqualTo("Task 4");
    assertThat(first.text("/items/0/actorName")).isEqualTo("Owner");
    List<String> seen = new ArrayList<>();
    String cursor = null;
    do {
      Resp page = get(base(f) + "?limit=2" + (cursor == null ? "" : "&cursor=" + cursor), token);
      page.at("/items").forEach(n -> seen.add(n.get("taskTitle").asText()));
      cursor =
          page.at("/nextCursor").isNull() || page.at("/nextCursor").isMissingNode()
              ? null
              : page.text("/nextCursor");
    } while (cursor != null);
    assertThat(seen).containsExactly("Task 4", "Task 3", "Task 2", "Task 1", "Task 0");
    assertThat(get(base(f) + "/unread-count", token).at("/count").asLong()).isEqualTo(5);
    assertThat(get(base(f) + "?unread=true&limit=200", token).at("/items")).hasSize(5);
  }

  @Test
  void markAllReadStopsAtTheBoundaryAndALaterOneStaysUnread() {
    Fx f = fx();
    UUID newest = assignedTasks(f, 3);
    String token = f.ws().member().token();
    UUID boundary = get(base(f) + "?limit=1", token).uuid("/items/0/id");
    UUID later = taskFor(f.ws().owner(), f.list(), "Later", f.ws().member().id());
    awaitKind(f.ws().member().id(), later, "ASSIGNED");
    Resp done = post(base(f) + "/read-all", token, Map.of("upToId", boundary));
    assertThat(done.status()).isEqualTo(200);
    assertThat(done.at("/marked").asLong()).isEqualTo(3);
    assertThat(get(base(f) + "/unread-count", token).at("/count").asLong()).isEqualTo(1);
    assertThat(newest).isNotNull();
    var unread = get(base(f) + "?unread=true", token).at("/items");
    assertThat(unread).hasSize(1);
    assertThat(unread.get(0).get("taskTitle").asText()).isEqualTo("Later");
  }

  @Test
  void markReadAndUnreadByIdAndSomeoneElsesNotificationIs404() {
    Fx f = fx();
    assignedTasks(f, 1);
    String token = f.ws().member().token();
    UUID id = get(base(f), token).uuid("/items/0/id");
    assertThat(post("/api/v1/notifications/" + id + "/read", token, null).status()).isEqualTo(204);
    assertThat(get(base(f) + "/unread-count", token).at("/count").asLong()).isZero();
    assertThat(get(base(f), token).at("/items/0/read").asBoolean()).isTrue();
    assertThat(delete("/api/v1/notifications/" + id + "/read", token).status()).isEqualTo(204);
    assertThat(get(base(f) + "/unread-count", token).at("/count").asLong()).isEqualTo(1);
    assertThat(post("/api/v1/notifications/" + id + "/read", f.ws().admin().token(), null).status())
        .isEqualTo(404);
    assertThat(delete("/api/v1/notifications/" + id + "/read", f.ws().admin().token()).status())
        .isEqualTo(404);
  }

  @Test
  void aNotificationWhoseTaskBecameInvisibleIsHiddenFromListAndCount() {
    Fx f = fx();
    UUID secret = list(f.ws().owner(), f.space(), "Secret");
    UUID task = taskFor(f.ws().owner(), secret, "Hidden later", f.ws().member().id());
    awaitKind(f.ws().member().id(), task, "ASSIGNED");
    String token = f.ws().member().token();
    assertThat(get(base(f) + "/unread-count", token).at("/count").asLong()).isEqualTo(1);
    long v = get("/api/v1/locations/" + secret, f.ws().owner().token()).at("/version").asLong();
    assertThat(
            patch("/api/v1/locations/" + secret, f.ws().owner().token(), Map.of("isPrivate", true))
                .status())
        .isLessThan(300);
    assertThat(v).isGreaterThanOrEqualTo(0);
    assertThat(get(base(f) + "/unread-count", token).at("/count").asLong()).isZero();
    assertThat(get(base(f), token).at("/items")).isEmpty();
    assertThat(get(base(f), f.ws().owner().token()).status()).isEqualTo(200);
  }

  @Test
  void aStrangerCannotReadAnotherWorkspacesInbox() {
    Fx f = fx();
    TestUser stranger = signUp("Stranger");
    assertThat(get(base(f), stranger.token()).status()).isEqualTo(404);
    assertThat(get(base(f) + "/unread-count", stranger.token()).status()).isEqualTo(404);
  }
}
