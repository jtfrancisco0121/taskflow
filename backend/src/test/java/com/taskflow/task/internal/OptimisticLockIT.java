package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("TASK-6 optimistic locking")
class OptimisticLockIT extends IntegrationTest {

  private UUID newTask(Ws ws) {
    return task(ws.member(), list(ws.member(), space(ws.owner(), ws.id(), "S"), "L"), "Original");
  }

  @Test
  void twoParallelEditsWithTheSameVersionOneWinsAndTheOtherGets409WithTheCurrentTask()
      throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID id = newTask(ws);
    CountDownLatch go = new CountDownLatch(1);
    CompletableFuture<Resp> a =
        CompletableFuture.supplyAsync(() -> {
          await(go);
          return patchTask(ws.member(), id, 1, Map.of("title", "From A"));
        });
    CompletableFuture<Resp> b =
        CompletableFuture.supplyAsync(() -> {
          await(go);
          return patchTask(ws.admin(), id, 1, Map.of("title", "From B"));
        });
    go.countDown();
    Resp ra = a.get();
    Resp rb = b.get();
    assertThat(List.of(ra.status(), rb.status())).containsExactlyInAnyOrder(200, 409);
    Resp winner = ra.status() == 200 ? ra : rb;
    Resp loser = ra.status() == 409 ? ra : rb;
    assertThat(loser.text("/code")).isEqualTo("task.version_conflict");
    assertThat(loser.at("/current/version").asLong()).isEqualTo(2);
    assertThat(loser.text("/current/title")).isEqualTo(winner.text("/title"));
    assertThat(loser.at("/version").asLong()).isEqualTo(2);
    assertThat(get("/api/v1/tasks/" + id, ws.owner().token()).text("/title"))
        .isEqualTo(winner.text("/title"));
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE entity_id = ? AND type = 'task.updated'",
                Integer.class,
                id))
        .isEqualTo(1);
  }

  @Test
  void aStaleVersionIs409AndANewOneWorks() {
    Ws ws = workspaceWithAllRoles();
    UUID id = newTask(ws);
    assertThat(patchTask(ws.member(), id, 1, Map.of("title", "v2")).status()).isEqualTo(200);
    Resp stale = patchTask(ws.member(), id, 1, Map.of("title", "late"));
    assertThat(stale.status()).isEqualTo(409);
    assertThat(stale.text("/current/title")).isEqualTo("v2");
    assertThat(patchTask(ws.member(), id, 2, Map.of("title", "v3")).status()).isEqualTo(200);
  }

  @Test
  void aMissingIfMatchIs428AndWeakAndBareFormsAreAccepted() {
    Ws ws = workspaceWithAllRoles();
    UUID id = newTask(ws);
    Resp missing = patch("/api/v1/tasks/" + id, ws.member().token(), Map.of("title", "x"));
    assertThat(missing.status()).isEqualTo(428);
    assertThat(missing.text("/code")).isEqualTo("task.if_match_required");
    assertThat(
            patch(
                    "/api/v1/tasks/" + id,
                    ws.member().token(),
                    Map.of("title", "bare"),
                    "If-Match",
                    "1")
                .status())
        .isEqualTo(200);
    assertThat(
            patch(
                    "/api/v1/tasks/" + id,
                    ws.member().token(),
                    Map.of("title", "weak"),
                    "If-Match",
                    "W/\"2\"")
                .status())
        .isEqualTo(200);
    assertThat(
            patch(
                    "/api/v1/tasks/" + id,
                    ws.member().token(),
                    Map.of("title", "junk"),
                    "If-Match",
                    "abc")
                .status())
        .isEqualTo(400);
    assertThat(get("/api/v1/tasks/" + id, ws.member().token()).headers().getFirst("ETag"))
        .isEqualTo("\"3\"");
  }

  @Test
  void assigneeAndTagEditsAlsoBumpTheVersion() {
    Ws ws = workspaceWithAllRoles();
    UUID id = newTask(ws);
    Resp r = patchTask(ws.member(), id, 1, Map.of("tags", List.of("x")));
    assertThat(r.at("/version").asLong()).isEqualTo(2);
    Resp stale = patchTask(ws.member(), id, 1, Map.of("assigneeIds", List.of(ws.admin().id())));
    assertThat(stale.status()).isEqualTo(409);
    assertThat(stale.at("/current/tags").get(0).asText()).isEqualTo("x");
  }

  private static void await(CountDownLatch latch) {
    try {
      latch.await();
    } catch (InterruptedException e) {
      throw new IllegalStateException(e);
    }
  }
}
