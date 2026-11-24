package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("TASK-3 move and duplicate")
class TaskMoveIT extends TaskTestBase {

  /** Replaces a Space's default set (no tasks yet) with backlog / doing / shipped. */
  private void customSet(Ws ws, UUID space) {
    Resp current = get("/api/v1/locations/" + space + "/statuses", ws.owner().token());
    Map<String, String> target =
        Map.of(
            "to do", "backlog", "in progress", "doing", "complete", "shipped", "closed", "shipped");
    List<Map<String, Object>> remap = new java.util.ArrayList<>();
    current
        .at("/statuses")
        .forEach(s ->
            remap.add(
                Map.of("from", s.get("id").asText(), "to", target.get(s.get("name").asText()))));
    Resp r =
        put(
            "/api/v1/locations/" + space + "/statuses",
            ws.owner().token(),
            Map.of(
                "statuses",
                List.of(
                    Map.of("name", "backlog", "group", "NOT_STARTED"),
                    Map.of("name", "doing", "group", "ACTIVE"),
                    Map.of("name", "shipped", "group", "DONE")),
                "remap",
                remap));
    assertThat(r.status()).as(r.raw()).isEqualTo(200);
  }

  @Test
  void aMoveTakesTheSubtasksAndRemapsAStatusTheTargetLacks() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID otherSpace = space(f.ws().owner(), f.ws().id(), "Other");
    customSet(f.ws(), otherSpace);
    UUID target = list(m, otherSpace, "Target");

    UUID parent = task(m, f.list(), "Parent");
    UUID child = subtask(m, f.list(), parent, "Child");
    UUID grandchild = subtask(m, f.list(), child, "Grandchild");
    // parent: in progress (ACTIVE) -> doing; child: closed (CLOSED, no CLOSED in target) ->
    // backlog;
    // grandchild: complete (DONE) -> shipped
    patchTask(m, parent, 1, Map.of("statusId", statusId(f.space(), "in progress")));
    patchTask(m, child, 1, Map.of("statusId", statusId(f.space(), "closed")));
    patchTask(m, grandchild, 1, Map.of("statusId", statusId(f.space(), "complete")));
    long parentVersion = version(m, parent);

    Resp r = move(m, parent, parentVersion, Map.of("listId", target));
    assertThat(r.status()).as(r.raw()).isEqualTo(200);
    assertThat(r.text("/listId")).isEqualTo(target.toString());
    assertThat(r.at("/version").asLong()).isEqualTo(parentVersion + 1);
    assertThat(r.text("/statusId")).isEqualTo(statusId(otherSpace, "doing").toString());
    assertThat(read(m, child).get("listId").asText()).isEqualTo(target.toString());
    assertThat(read(m, child).get("parentTaskId").asText()).isEqualTo(parent.toString());
    assertThat(read(m, child).get("statusId").asText())
        .isEqualTo(statusId(otherSpace, "backlog").toString());
    assertThat(read(m, grandchild).get("listId").asText()).isEqualTo(target.toString());
    assertThat(read(m, grandchild).get("statusId").asText())
        .isEqualTo(statusId(otherSpace, "shipped").toString());
    assertThat(events(parent, "task.moved")).isEqualTo(1);
    assertThat(events(child, "task.moved")).isEqualTo(1);
    assertThat(events(grandchild, "task.moved")).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM task WHERE list_id = ? AND id IN (?, ?, ?)",
                Integer.class,
                f.list(),
                parent,
                child,
                grandchild))
        .isZero();
  }

  @Test
  void anExplicitStatusIsUsedAndMustBeValidInTheTarget() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID otherSpace = space(f.ws().owner(), f.ws().id(), "Other");
    customSet(f.ws(), otherSpace);
    UUID target = list(m, otherSpace, "Target");
    UUID t = task(m, f.list(), "T");
    Resp bad = move(m, t, 1, Map.of("listId", target, "statusId", statusId(f.space(), "to do")));
    assertThat(bad.status()).isEqualTo(400);
    assertThat(bad.text("/code")).isEqualTo("task.invalid_status");
    Resp ok = move(m, t, 1, Map.of("listId", target, "statusId", statusId(otherSpace, "shipped")));
    assertThat(ok.status()).isEqualTo(200);
    assertThat(ok.text("/statusId")).isEqualTo(statusId(otherSpace, "shipped").toString());
  }

  @Test
  void aMoveWithinTheListReordersAndNeedsIfMatch() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, f.list(), "B");
    UUID c = task(m, f.list(), "C");
    String rankA = jdbc.queryForObject("SELECT rank FROM task WHERE id = ?", String.class, a);
    Resp r = move(m, c, 1, Map.of("listId", f.list(), "beforeId", a));
    assertThat(r.status()).isEqualTo(200);
    assertThat(
            jdbc.queryForList(
                "SELECT id FROM task WHERE list_id = ? ORDER BY rank COLLATE \"C\"",
                UUID.class,
                f.list()))
        .containsExactly(c, a, b);
    assertThat(jdbc.queryForObject("SELECT rank FROM task WHERE id = ?", String.class, a))
        .isEqualTo(rankA);
    Resp missing = post("/api/v1/tasks/" + a + "/move", m.token(), Map.of("listId", f.list()));
    assertThat(missing.status()).isEqualTo(428);
    assertThat(move(m, a, 99, Map.of("listId", f.list())).status()).isEqualTo(409);
  }

  @Test
  void aDuplicateIsANewTaskWithANewReadableIdAndItsSubtreeAndChecklists() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID parent = task(m, f.list(), "Parent");
    UUID child = subtask(m, f.list(), parent, "Child");
    patchTask(
        m,
        parent,
        1,
        Map.of(
            "tags", List.of("x"), "assigneeIds", List.of(f.ws().admin().id()), "priority", "HIGH"));
    UUID checklist =
        post("/api/v1/tasks/" + parent + "/checklists", m.token(), Map.of("name", "CL"))
            .uuid("/id");
    post("/api/v1/checklists/" + checklist + "/items", m.token(), Map.of("text", "item"));
    long before =
        jdbc.queryForObject(
            "SELECT count(*) FROM task WHERE workspace_id = ?", Long.class, f.ws().id());

    String key = UUID.randomUUID().toString();
    Resp copy =
        post("/api/v1/tasks/" + parent + "/duplicate", m.token(), Map.of(), "Idempotency-Key", key);
    assertThat(copy.status()).isEqualTo(201);
    Resp again =
        post("/api/v1/tasks/" + parent + "/duplicate", m.token(), Map.of(), "Idempotency-Key", key);
    assertThat(again.raw()).isEqualTo(copy.raw());
    UUID copyId = copy.uuid("/id");
    assertThat(copyId).isNotEqualTo(parent);
    assertThat(copy.text("/title")).isEqualTo("Parent (copy)");
    assertThat(copy.at("/number").asLong()).isGreaterThan(2);
    assertThat(copy.text("/readableId")).isNotEqualTo(read(m, parent).get("readableId").asText());
    assertThat(copy.at("/tags").get(0).asText()).isEqualTo("x");
    assertThat(copy.text("/priority")).isEqualTo("HIGH");
    assertThat(copy.at("/assigneeIds").get(0).asText()).isEqualTo(f.ws().admin().id().toString());
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM task WHERE workspace_id = ?", Long.class, f.ws().id()))
        .isEqualTo(before + 2);
    UUID childCopy =
        jdbc.queryForObject("SELECT id FROM task WHERE parent_task_id = ?", UUID.class, copyId);
    assertThat(childCopy).isNotEqualTo(child);
    assertThat(read(m, childCopy).get("title").asText()).isEqualTo("Child");
    Resp lists = get("/api/v1/tasks/" + copyId + "/checklists", m.token());
    assertThat(lists.at("/0/name").asText()).isEqualTo("CL");
    assertThat(lists.at("/0/items/0/text").asText()).isEqualTo("item");
    assertThat(lists.at("/0/id").asText()).isNotEqualTo(checklist.toString());
    assertThat(events(copyId, "task.duplicated")).isEqualTo(1);
    assertThat(events(childCopy, "task.created")).isEqualTo(1);
    assertThat(read(m, parent).get("version").asLong())
        .as("the original is untouched by the duplicate")
        .isEqualTo(4);
  }

  @Test
  void aDuplicateCanTargetAnotherList() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID otherList = list(m, f.space(), "Other");
    UUID parent = task(m, f.list(), "Parent");
    UUID child = subtask(m, f.list(), parent, "Child");
    Resp copy =
        post("/api/v1/tasks/" + child + "/duplicate", m.token(), Map.of("listId", otherList));
    assertThat(copy.status()).isEqualTo(201);
    assertThat(copy.text("/listId")).isEqualTo(otherList.toString());
    assertThat(copy.at("/parentTaskId").isNull()).isTrue();
  }

  @Test
  void aParallelMoveAndEditWithTheSameVersionGiveOneSuccessAndOne409() throws Exception {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID target = list(m, f.space(), "Target");
    UUID t = task(m, f.list(), "T");
    CountDownLatch go = new CountDownLatch(1);
    CompletableFuture<Resp> mv =
        CompletableFuture.supplyAsync(() -> {
          await(go);
          return move(m, t, 1, Map.of("listId", target));
        });
    CompletableFuture<Resp> ed =
        CompletableFuture.supplyAsync(() -> {
          await(go);
          return patchTask(f.ws().admin(), t, 1, Map.of("title", "edited"));
        });
    go.countDown();
    assertThat(List.of(mv.get().status(), ed.get().status())).containsExactlyInAnyOrder(200, 409);
    assertThat(version(m, t)).isEqualTo(2);
  }

  @Test
  void movingIntoAPrivateListWithoutAGrantIs404AndNothingChanges() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID secret =
        location(
            f.ws().owner(),
            Map.of("type", "LIST", "parentId", f.space(), "name", "Secret", "isPrivate", true));
    UUID inSecret = task(f.ws().owner(), secret, "hidden");
    UUID t = task(m, f.list(), "T");
    Resp r = move(m, t, 1, Map.of("listId", secret));
    assertThat(r.status()).isEqualTo(404);
    assertThat(read(m, t).get("listId").asText()).isEqualTo(f.list().toString());
    assertThat(version(m, t)).isEqualTo(1);
    Resp neighbour = move(m, t, 1, Map.of("listId", f.list(), "beforeId", inSecret));
    assertThat(neighbour.status()).isEqualTo(404);
    Resp missing = move(m, t, 1, Map.of("listId", f.list(), "beforeId", UUID.randomUUID()));
    assertThat(missing.status()).isEqualTo(404);
    assertThat(missing.text("/code")).isEqualTo(neighbour.text("/code"));
  }

  @Test
  void aNeighbourFromAnotherListIsRefused() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID otherList = list(m, f.space(), "Other");
    UUID inOther = task(m, otherList, "other");
    UUID t = task(m, f.list(), "T");
    Resp r = move(m, t, 1, Map.of("listId", f.list(), "beforeId", inOther));
    assertThat(r.status()).isEqualTo(400);
    assertThat(r.text("/code")).isEqualTo("rank.neighbour_out_of_scope");
    assertThat(version(m, t)).isEqualTo(1);
  }

  @Test
  void aTargetThatIsNotAListOrIsArchivedIsRefused() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID t = task(m, f.list(), "T");
    assertThat(move(m, t, 1, Map.of("listId", f.space())).text("/code"))
        .isEqualTo("task.not_a_list");
    UUID archived = list(m, f.space(), "Archived");
    post("/api/v1/locations/" + archived + "/archive", m.token(), null);
    Resp r = move(m, t, 1, Map.of("listId", archived));
    assertThat(r.status()).isEqualTo(409);
    assertThat(r.text("/code")).isEqualTo("location.archived");
    Map<String, Object> noList = new HashMap<>();
    assertThat(post("/api/v1/tasks/" + t + "/move", m.token(), noList, "If-Match", "1").status())
        .isEqualTo(400);
  }

  private static void await(CountDownLatch latch) {
    try {
      latch.await();
    } catch (InterruptedException e) {
      throw new IllegalStateException(e);
    }
  }
}
