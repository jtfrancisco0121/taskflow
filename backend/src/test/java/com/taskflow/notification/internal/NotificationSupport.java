package com.taskflow.notification.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.identity.internal.ServiceAccountTestBase;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import org.awaitility.Awaitility;

/** Helpers of the notification ITs. */
abstract class NotificationSupport extends ServiceAccountTestBase {

  protected record Fx(Ws ws, UUID space, UUID list) {}

  protected Fx fx() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Eng");
    return new Fx(ws, space, list(ws.owner(), space, "Backlog"));
  }

  protected UUID taskFor(TestUser creator, UUID list, String title, UUID... assignees) {
    Resp r =
        post(
            "/api/v1/lists/" + list + "/tasks",
            creator.token(),
            Map.of("title", title, "assigneeIds", List.of(assignees)));
    if (r.status() != 201) {
      throw new IllegalStateException("task failed " + r.raw());
    }
    return r.uuid("/id");
  }

  protected static JsonNode doc(
      com.fasterxml.jackson.databind.ObjectMapper mapper, String text, UUID... mentions) {
    var doc = mapper.createObjectNode().put("type", "doc");
    var paragraph = doc.putArray("content").addObject().put("type", "paragraph");
    var content = paragraph.putArray("content");
    for (UUID m : mentions) {
      content.addObject().put("type", "mention").putObject("attrs").put("id", m.toString());
    }
    content.addObject().put("type", "text").put("text", text);
    return doc;
  }

  protected Resp comment(TestUser user, UUID task, String text, UUID... mentions) {
    return post(
        "/api/v1/tasks/" + task + "/comments",
        user.token(),
        Map.of("body", doc(mapper, text, mentions)));
  }

  protected List<String> kinds(UUID recipient, UUID task) {
    return jdbc.queryForList(
        "SELECT kind FROM notification WHERE recipient_id = ? AND task_id = ? ORDER BY created_at,"
            + " kind",
        String.class,
        recipient,
        task);
  }

  protected long count(UUID recipient, UUID task, String kind) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM notification WHERE recipient_id = ? AND task_id = ? AND kind = ?",
        Long.class,
        recipient,
        task,
        kind);
  }

  protected <T> T await(Callable<T> check, java.util.function.Predicate<T> done) {
    return Awaitility.await()
        .atMost(Duration.ofSeconds(20))
        .pollInterval(Duration.ofMillis(100))
        .until(check, done);
  }

  protected void awaitKind(UUID recipient, UUID task, String kind) {
    await(() -> count(recipient, task, kind), n -> n >= 1);
  }

  protected void pause(long millis) {
    try {
      Thread.sleep(millis);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }

  protected boolean watching(UUID task, UUID user) {
    var rows =
        jdbc.queryForList(
            "SELECT watching FROM task_watcher WHERE task_id = ? AND user_id = ?",
            Boolean.class,
            task,
            user);
    return !rows.isEmpty() && rows.get(0);
  }
}
