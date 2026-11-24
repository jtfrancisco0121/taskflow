package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("DEP-3 blocked state is derived once and agrees on every read path")
class BlockedStateIT extends DependencyTestBase {

  private JsonNode listed(TestUser user, UUID list, UUID task) {
    for (JsonNode n : get("/api/v1/tasks?locationId=" + list, user.token()).at("/items")) {
      if (n.get("id").asText().equals(task.toString())) {
        return n;
      }
    }
    throw new IllegalStateException("task not listed");
  }

  @Test
  void blockedFollowsTheBlockerThroughCompleteReopenTrashAndRestore() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID a = task(m, f.list(), "Waiting");
    UUID b = task(m, f.list(), "Blocker");
    relate(m, a, "WAITING_ON", b);
    assertThat(read(m, a).get("blocked").asBoolean()).isTrue();
    assertThat(blockerCount(m, a)).isEqualTo(1);
    assertThat(blocked(m, b)).isFalse();

    assertThat(setStatus(m, f.space(), b, "in progress").status()).isEqualTo(200);
    assertThat(blocked(m, a)).as("ACTIVE still counts").isTrue();
    assertThat(setStatus(m, f.space(), b, "complete").status()).isEqualTo(200);
    assertThat(blocked(m, a)).as("DONE").isFalse();
    assertThat(blockerCount(m, a)).isZero();
    assertThat(setStatus(m, f.space(), b, "to do").status()).isEqualTo(200);
    assertThat(blocked(m, a)).as("reopened").isTrue();
    assertThat(setStatus(m, f.space(), b, "closed").status()).isEqualTo(200);
    assertThat(blocked(m, a)).as("CLOSED").isFalse();
    assertThat(setStatus(m, f.space(), b, "in progress").status()).isEqualTo(200);
    assertThat(blocked(m, a)).isTrue();

    assertThat(trash(m, b, version(m, b)).status()).isEqualTo(204);
    assertThat(blocked(m, a)).as("trashed blocker").isFalse();
    assertThat(
            restore(
                    m,
                    b,
                    jdbc.queryForObject("SELECT version FROM task WHERE id = ?", Long.class, b))
                .status())
        .isEqualTo(200);
    assertThat(blocked(m, a)).as("restored").isTrue();
  }

  @Test
  void twoBlockersCountAndAnArchivedListStillBlocksWhileADeletedOneDoesNot() {
    Fix f = fixture();
    TestUser o = f.ws().owner();
    TestUser m = f.ws().member();
    UUID archivedList = list(o, f.space(), "Archived");
    UUID deletedList = list(o, f.space(), "Deleted");
    UUID a = task(m, f.list(), "Waiting");
    UUID inArchived = task(o, archivedList, "In archived");
    UUID inDeleted = task(o, deletedList, "In deleted");
    relate(o, a, "WAITING_ON", inArchived);
    relate(o, a, "WAITING_ON", inDeleted);
    assertThat(blockerCount(m, a)).isEqualTo(2);

    assertThat(post("/api/v1/locations/" + archivedList + "/archive", o.token(), null).status())
        .isEqualTo(200);
    assertThat(blockerCount(m, a)).as("archived still counts").isEqualTo(2);
    assertThat(delete("/api/v1/locations/" + deletedList, o.token()).status()).isEqualTo(204);
    assertThat(blockerCount(m, a)).as("deleted List does not").isEqualTo(1);
    assertThat(blocked(m, a)).isTrue();
  }

  @Test
  void everyReadPathReturnsTheSameAnswer() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID blockedTask = task(m, f.list(), "Zebra blocked");
    UUID free = task(m, f.list(), "Zebra free");
    UUID blocker = task(m, f.list(), "Blocker");
    relate(m, blockedTask, "WAITING_ON", blocker);
    Agent agent = agent(f.ws().admin(), f.ws().id());

    for (UUID t : List.of(blockedTask, free, blocker)) {
      boolean expected = t.equals(blockedTask);
      assertThat(read(m, t).get("blocked").asBoolean()).as("get").isEqualTo(expected);
      assertThat(listed(m, f.list(), t).get("blocked").asBoolean()).as("list").isEqualTo(expected);
      assertThat(listed(m, f.list(), t).get("blockerCount").asInt()).isEqualTo(expected ? 1 : 0);
    }
    // workspace search and the MCP search carry blocked and blockerCount
    JsonNode hits = get("/api/v1/workspaces/" + f.ws().id() + "/search?q=zebra", m.token()).json();
    for (JsonNode hit : hits.at("/items")) {
      boolean expected = hit.get("taskId").asText().equals(blockedTask.toString());
      assertThat(hit.get("blocked").asBoolean()).as("search").isEqualTo(expected);
      assertThat(hit.get("blockerCount").asInt()).isEqualTo(expected ? 1 : 0);
    }
    assertThat(hits.at("/items")).hasSize(2);
    ToolResult mcp = call(agent.secret(), "search_tasks", Map.of("query", "zebra"));
    assertThat(mcp.body()).isEqualTo(hits);
    ToolResult onlyBlocked = call(agent.secret(), "search_tasks", Map.of("blocked", true));
    assertThat(onlyBlocked.isError()).isFalse();
    assertThat(onlyBlocked.body().at("/items")).hasSize(1);
    assertThat(onlyBlocked.body().at("/items/0/taskId").asText()).isEqualTo(blockedTask.toString());
    assertThat(onlyBlocked.body().at("/items/0/blocked").asBoolean()).isTrue();
    assertThat(onlyBlocked.body().at("/items/0/blockerCount").asInt()).isEqualTo(1);
    ToolResult notBlocked =
        call(agent.secret(), "search_tasks", Map.of("blocked", false, "query", "zebra"));
    assertThat(notBlocked.body().at("/items")).hasSize(1);
    assertThat(notBlocked.body().at("/items/0/taskId").asText()).isEqualTo(free.toString());

    // views: the same flag on the task of each item
    Resp page =
        post(
            "/api/v1/views/query",
            m.token(),
            Map.of("scope", Map.of("locationId", f.list()), "config", Map.of("v", 1), "limit", 50));
    boolean seen = false;
    for (JsonNode item : page.at("/items")) {
      boolean expected = item.at("/task/id").asText().equals(blockedTask.toString());
      assertThat(item.at("/task/blocked").asBoolean()).as("view").isEqualTo(expected);
      seen |= expected;
    }
    assertThat(seen).isTrue();
  }

  @Test
  void theBlockedFilterReturnsExactlyTheBlockedTasksAcrossPages() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID blocker = task(m, f.list(), "Blocker");
    Set<String> expected = new HashSet<>();
    for (int i = 0; i < 7; i++) {
      UUID t = task(m, f.list(), "Task " + i);
      if (i % 2 == 0) {
        relate(m, t, "WAITING_ON", blocker);
        expected.add(t.toString());
      }
    }
    for (String op : List.of("is_true", "is_false")) {
      List<String> ids = new ArrayList<>();
      String cursor = null;
      int guard = 0;
      do {
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("scope", Map.of("locationId", f.list()));
        body.put("config", Map.of("v", 1, "filter", Map.of("field", "blocked", "op", op)));
        body.put("limit", 2);
        body.put("cursor", cursor);
        Resp r = post("/api/v1/views/query", m.token(), body);
        assertThat(r.status()).as(r.raw()).isEqualTo(200);
        r.at("/items").forEach(n -> ids.add(n.at("/task/id").asText()));
        cursor = r.at("/nextCursor").isNull() ? null : r.text("/nextCursor");
        assertThat(++guard).isLessThan(20);
      } while (cursor != null);
      assertThat(ids).doesNotHaveDuplicates();
      if (op.equals("is_true")) {
        assertThat(ids).containsExactlyInAnyOrderElementsOf(expected);
      } else {
        assertThat(ids).doesNotContainAnyElementsOf(expected).hasSize(8 - expected.size());
      }
    }
  }

  @Test
  void theFilterRefusesAValueAndAnUnknownOperator() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    for (Map<String, Object> filter :
        List.<Map<String, Object>>of(
            Map.of("field", "blocked", "op", "is_true", "value", true),
            Map.of("field", "blocked", "op", "contains"))) {
      Resp r =
          post(
              "/api/v1/views/query",
              m.token(),
              Map.of(
                  "scope",
                  Map.of("locationId", f.list()),
                  "config",
                  Map.of("v", 1, "filter", filter)));
      assertThat(r.status()).as(filter.toString()).isEqualTo(400);
    }
  }
}
