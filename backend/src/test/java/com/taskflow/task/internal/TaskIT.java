package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("TASK-1 create and edit tasks")
class TaskIT extends IntegrationTest {

  private static Map<String, Object> doc(String text) {
    return Map.of(
        "type",
        "doc",
        "content",
        List.of(
            Map.of("type", "paragraph", "content", List.of(Map.of("type", "text", "text", text)))));
  }

  private int eventCount(String table, UUID task, String type) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM " + table + " WHERE entity_id = ? AND type = ?",
        Integer.class,
        task,
        type);
  }

  @Test
  void everyFieldIsCreatedAndReadBack() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    Map<String, Object> body = new HashMap<>();
    body.put("title", "  Ship it  ");
    body.put("description", doc("hello"));
    body.put("priority", "HIGH");
    body.put("startDate", "2026-12-01T09:00:00Z");
    body.put("dueDate", "2026-12-24T17:00:00Z");
    body.put("assigneeIds", List.of(ws.member().id(), ws.admin().id()));
    body.put("tags", List.of(" Bug ", "bug", "UI"));

    Resp created = post("/api/v1/lists/" + list + "/tasks", ws.member().token(), body);
    assertThat(created.status()).isEqualTo(201);
    assertThat(created.headers().getFirst("ETag")).isEqualTo("\"1\"");
    assertThat(created.text("/readableId")).isEqualTo(ws.key() + "-1");
    assertThat(created.at("/version").asLong()).isEqualTo(1);

    Resp read = get("/api/v1/tasks/" + created.text("/id"), ws.guest().token());
    assertThat(read.status()).as("a guest without a grant sees nothing").isEqualTo(404);
    read = get("/api/v1/tasks/" + created.text("/id"), ws.owner().token());
    assertThat(read.status()).isEqualTo(200);
    assertThat(read.text("/title")).isEqualTo("Ship it");
    assertThat(read.at("/description")).isEqualTo(mapper.valueToTree(doc("hello")));
    assertThat(read.text("/priority")).isEqualTo("HIGH");
    assertThat(read.text("/startDate")).isEqualTo("2026-12-01T09:00:00Z");
    assertThat(read.text("/dueDate")).isEqualTo("2026-12-24T17:00:00Z");
    assertThat(read.at("/assigneeIds")).hasSize(2);
    assertThat(read.at("/tags").toString()).isEqualTo("[\"bug\",\"ui\"]");
    assertThat(read.text("/listId")).isEqualTo(list.toString());
  }

  @Test
  void aTaskWithoutAStatusGetsToDo_STAT2() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    UUID id = task(ws.member(), list, "t");
    Resp read = get("/api/v1/tasks/" + id, ws.member().token());
    UUID todo =
        jdbc.queryForObject(
            "SELECT id FROM status WHERE location_id = ? AND name = 'to do'", UUID.class, space);
    assertThat(read.text("/statusId")).isEqualTo(todo.toString());
  }

  @Test
  void eachFieldCanBeEditedAndClearedAndEveryWriteLeavesOneEventPair() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    UUID id = task(ws.member(), list, "Start");
    UUID done =
        jdbc.queryForObject(
            "SELECT id FROM status WHERE location_id = ? AND name = 'complete'", UUID.class, space);
    assertThat(eventCount("outbox_event", id, "task.created")).isEqualTo(1);
    assertThat(eventCount("activity_event", id, "task.created")).isEqualTo(1);

    Map<String, Object> all = new HashMap<>();
    all.put("title", "Renamed");
    all.put("description", doc("body"));
    all.put("priority", "URGENT");
    all.put("startDate", "2026-12-01T00:00:00Z");
    all.put("dueDate", "2026-12-02T00:00:00Z");
    all.put("assigneeIds", List.of(ws.admin().id()));
    all.put("tags", List.of("a", "b"));
    Resp edited = patchTask(ws.member(), id, 1, all);
    assertThat(edited.status()).as(edited.raw()).isEqualTo(200);
    assertThat(edited.headers().getFirst("ETag")).isEqualTo("\"2\"");
    assertThat(edited.text("/title")).isEqualTo("Renamed");
    assertThat(edited.text("/priority")).isEqualTo("URGENT");
    assertThat(edited.at("/assigneeIds").get(0).asText()).isEqualTo(ws.admin().id().toString());
    assertThat(edited.at("/version").asLong()).isEqualTo(2);
    assertThat(eventCount("outbox_event", id, "task.updated")).isEqualTo(1);
    assertThat(eventCount("activity_event", id, "task.updated")).isEqualTo(1);

    Resp statusChange = patchTask(ws.member(), id, 2, Map.of("statusId", done));
    assertThat(statusChange.status()).isEqualTo(200);
    assertThat(eventCount("outbox_event", id, "task.status_changed")).isEqualTo(1);
    assertThat(eventCount("activity_event", id, "task.status_changed")).isEqualTo(1);

    Map<String, Object> clear = new HashMap<>();
    clear.put("description", null);
    clear.put("startDate", null);
    clear.put("dueDate", null);
    clear.put("assigneeIds", List.of());
    clear.put("tags", List.of());
    Resp cleared = patchTask(ws.member(), id, 3, clear);
    assertThat(cleared.status()).as(cleared.raw()).isEqualTo(200);
    assertThat(cleared.at("/description").isNull()).isTrue();
    assertThat(cleared.at("/dueDate").isNull()).isTrue();
    assertThat(cleared.at("/assigneeIds")).isEmpty();
    assertThat(cleared.at("/tags")).isEmpty();

    Resp noop = patchTask(ws.member(), id, 4, Map.of("title", "Renamed"));
    assertThat(noop.status()).isEqualTo(200);
    assertThat(noop.at("/version").asLong()).as("a no-op does not bump the version").isEqualTo(4);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE entity_id = ?", Integer.class, id))
        .isEqualTo(4);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM activity_event WHERE entity_id = ?", Integer.class, id))
        .isEqualTo(4);
  }

  @Test
  void invalidInputGetsAProblemResponse() {
    Ws ws = workspaceWithAllRoles();
    Ws other = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    UUID otherSpace = space(ws.owner(), ws.id(), "Other");
    UUID otherList = list(ws.member(), otherSpace, "OL");
    UUID foreignStatus =
        jdbc.queryForObject(
            "SELECT id FROM status WHERE location_id = ? AND name = 'to do'",
            UUID.class,
            space(other.owner(), other.id(), "F"));
    String path = "/api/v1/lists/" + list + "/tasks";
    String token = ws.member().token();

    Resp blank = post(path, token, Map.of("title", " "));
    assertThat(blank.status()).isEqualTo(400);
    assertThat(blank.at("/errors")).isNotEmpty();
    assertThat(post(path, token, Map.of("title", "x", "priority", "SOON")).status()).isEqualTo(400);
    assertThat(post(path, token, Map.of("title", "x", "statusId", foreignStatus)).text("/code"))
        .isEqualTo("task.invalid_status");
    assertThat(post(path, token, Map.of("title", "x", "statusId", UUID.randomUUID())).text("/code"))
        .isEqualTo("task.invalid_status");
    assertThat(
            post(path, token, Map.of("title", "x", "assigneeIds", List.of(other.member().id())))
                .text("/code"))
        .isEqualTo("task.invalid_assignee");
    assertThat(
            post(path, token, Map.of("title", "x", "assigneeIds", List.of(UUID.randomUUID())))
                .status())
        .isEqualTo(400);
    assertThat(
            post(
                    path,
                    token,
                    Map.of(
                        "title",
                        "x",
                        "startDate",
                        "2026-12-02T00:00:00Z",
                        "dueDate",
                        "2026-12-01T00:00:00Z"))
                .text("/code"))
        .isEqualTo("task.invalid_dates");
    assertThat(
            post(path, token, Map.of("title", "x", "description", Map.of("type", "paragraph")))
                .text("/code"))
        .isEqualTo("task.invalid_description");
    String big = "x".repeat(300_000);
    assertThat(post(path, token, Map.of("title", "x", "description", doc(big))).text("/code"))
        .isEqualTo("task.invalid_description");
    assertThat(post("/api/v1/lists/" + space + "/tasks", token, Map.of("title", "x")).text("/code"))
        .isEqualTo("task.not_a_list");

    UUID id = task(ws.member(), list, "ok");
    assertThat(patchTask(ws.member(), id, 1, Map.of("statusId", UUID.randomUUID())).text("/code"))
        .isEqualTo("task.invalid_status");
    assertThat(
            patchTask(
                    ws.member(),
                    id,
                    1,
                    Map.of(
                        "statusId",
                        jdbc.queryForObject(
                            "SELECT id FROM status WHERE location_id = ? AND name = 'complete'",
                            UUID.class,
                            space)))
                .status())
        .isEqualTo(200);
    assertThat(patchTask(ws.member(), id, 2, Map.of("title", "")).status()).isEqualTo(400);
    assertThat(
            patchTask(ws.member(), id, 2, Map.of("assigneeIds", List.of(other.owner().id())))
                .text("/code"))
        .isEqualTo("task.invalid_assignee");
    assertThat(
            patchTask(
                    ws.member(),
                    id,
                    2,
                    Map.of(
                        "statusId",
                        jdbc.queryForObject(
                            "SELECT id FROM status WHERE location_id = ? AND name = 'complete'",
                            UUID.class,
                            otherSpace)))
                .text("/code"))
        .isEqualTo("task.invalid_status");
    assertThat(otherList).isNotNull();
  }

  @Test
  void guestsCannotCreateOrEditAndArchivedListsAreReadOnly() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    UUID id = task(ws.member(), list, "t");
    put("/api/v1/locations/" + space + "/grants/" + ws.guest().id(), ws.owner().token(), null);
    assertThat(
            post("/api/v1/lists/" + list + "/tasks", ws.guest().token(), Map.of("title", "x"))
                .status())
        .isEqualTo(403);
    assertThat(patchTask(ws.guest(), id, 1, Map.of("title", "x")).status()).isEqualTo(403);
    assertThat(get("/api/v1/tasks/" + id, ws.guest().token()).status()).isEqualTo(200);

    post("/api/v1/locations/" + list + "/archive", ws.member().token(), null);
    Resp archived =
        post("/api/v1/lists/" + list + "/tasks", ws.member().token(), Map.of("title", "x"));
    assertThat(archived.status()).isEqualTo(409);
    assertThat(archived.text("/code")).isEqualTo("location.archived");
    assertThat(patchTask(ws.member(), id, 1, Map.of("title", "x")).status()).isEqualTo(409);
    assertThat(get("/api/v1/tasks/" + id, ws.member().token()).status()).isEqualTo(200);
  }

  @Test
  void parallelCreatesInOneListGetDistinctRanks() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    CountDownLatch go = new CountDownLatch(1);
    List<CompletableFuture<Integer>> futures = new ArrayList<>();
    for (int i = 0; i < 12; i++) {
      String title = "T" + i;
      futures.add(
          CompletableFuture.supplyAsync(() -> {
            try {
              go.await();
            } catch (InterruptedException e) {
              throw new IllegalStateException(e);
            }
            return post(
                    "/api/v1/lists/" + list + "/tasks", ws.member().token(), Map.of("title", title))
                .status();
          }));
    }
    go.countDown();
    for (CompletableFuture<Integer> f : futures) {
      assertThat(f.get()).isEqualTo(201);
    }
    List<String> ranks =
        jdbc.queryForList(
            "SELECT rank FROM task WHERE list_id = ? ORDER BY rank COLLATE \"C\"",
            String.class,
            list);
    assertThat(ranks).hasSize(12).doesNotHaveDuplicates();
  }

  @Test
  void createIsIdempotent() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    String key = UUID.randomUUID().toString();
    Resp first =
        post(
            "/api/v1/lists/" + list + "/tasks",
            ws.member().token(),
            Map.of("title", "Once"),
            "Idempotency-Key",
            key);
    Resp second =
        post(
            "/api/v1/lists/" + list + "/tasks",
            ws.member().token(),
            Map.of("title", "Once"),
            "Idempotency-Key",
            key);
    assertThat(first.status()).isEqualTo(201);
    assertThat(second.raw()).isEqualTo(first.raw());
    assertThat(
            jdbc.queryForObject("SELECT count(*) FROM task WHERE list_id = ?", Integer.class, list))
        .isEqualTo(1);
  }
}
