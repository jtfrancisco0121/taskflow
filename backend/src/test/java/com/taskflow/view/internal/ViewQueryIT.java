package com.taskflow.view.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

@DisplayName("VIEW-4 keyset paging, scope and visibility")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ViewQueryIT extends ViewTestBase {

  private static final int PER_LIST = 1700;

  private Ws ws;
  private UUID space;
  private List<UUID> lists;
  private UUID privateList;
  private UUID archivedList;
  private int visibleTotal;

  @BeforeAll
  void seed() {
    ws = workspaceWithAllRoles();
    space = space(ws.owner(), ws.id(), "Big");
    lists = new ArrayList<>();
    for (String n : List.of("Alpha", "Beta", "Gamma")) {
      lists.add(list(ws.member(), space, n));
    }
    privateList = list(ws.owner(), space, "Secret");
    patch("/api/v1/locations/" + privateList, ws.owner().token(), Map.of("isPrivate", true));
    archivedList = list(ws.owner(), space, "Old");
    List<UUID> all = new ArrayList<>(lists);
    all.add(privateList);
    all.add(archivedList);
    int number = 0;
    for (UUID list : all) {
      bulk(list, number, list == archivedList || list == privateList ? 50 : PER_LIST);
      number += 5000;
    }
    post("/api/v1/locations/" + archivedList + "/archive", ws.owner().token(), null);
    // two trashed tasks in a visible list
    jdbc.update(
        "UPDATE task SET deleted_at = now() WHERE id IN (SELECT id FROM task WHERE list_id = ? LIMIT 2)",
        lists.get(0));
    visibleTotal = PER_LIST * 3 - 2;
    // assignees: owner on every third task, member on every fifth
    jdbc.update(
        "INSERT INTO task_assignee (workspace_id, task_id, user_id) SELECT workspace_id, id, ? FROM task"
            + " WHERE workspace_id = ? AND number % 3 = 0",
        ws.owner().id(), ws.id());
    jdbc.update(
        "INSERT INTO task_assignee (workspace_id, task_id, user_id) SELECT workspace_id, id, ? FROM task"
            + " WHERE workspace_id = ? AND number % 5 = 0",
        ws.member().id(), ws.id());
    jdbc.update(
        "INSERT INTO task_tag (workspace_id, task_id, tag) SELECT workspace_id, id, 'bug' FROM task WHERE"
            + " workspace_id = ? AND number % 4 = 0",
        ws.id());
  }

  private void bulk(UUID list, int offset, int count) {
    List<UUID> statuses =
        jdbc.queryForList(
            "SELECT id FROM status WHERE location_id = ? AND retired_at IS NULL ORDER BY rank",
            UUID.class,
            space);
    jdbc.update(
        "INSERT INTO task (id, workspace_id, list_id, status_id, number, title, priority, due_date,"
            + " rank, created_by, created_at, updated_at) SELECT gen_random_uuid(), ?, ?, (?::uuid[])[1"
            + " + n % 4], ? + n, 'Task ' || (n % 37) || ' ' || n, (ARRAY['URGENT','HIGH','NORMAL','LOW',"
            + "'NONE'])[1 + n % 5], CASE WHEN n % 7 = 0 THEN NULL ELSE timestamptz '2026-01-01' + (n % 40)"
            + " * interval '1 day' END, 'r' || lpad(n::text, 6, '0'), ?, timestamptz '2025-01-01' + n *"
            + " interval '1 minute', timestamptz '2025-06-01' + (n % 100) * interval '1 minute' FROM"
            + " generate_series(1, ?) n",
        ws.id(),
        list,
        "{"
            + statuses.stream().map(UUID::toString).reduce((a, b) -> a + "," + b).orElseThrow()
            + "}",
        offset,
        ws.owner().id(),
        count);
  }

  private Resp query(
      TestUser user,
      Map<String, Object> scope,
      Map<String, Object> config,
      String groupValue,
      String cursor,
      int limit) {
    Map<String, Object> body = new HashMap<>();
    body.put("scope", scope);
    body.put("config", config);
    body.put("groupValue", groupValue);
    body.put("cursor", cursor);
    body.put("limit", limit);
    return post("/api/v1/views/query", user.token(), body);
  }

  /** Pages to the end; returns the task ids in order (repeats kept), item groups parallel. */
  private List<String> pageAll(
      TestUser user, Map<String, Object> scope, Map<String, Object> config, String groupValue) {
    List<String> out = new ArrayList<>();
    String cursor = null;
    int pages = 0;
    do {
      Resp r = query(user, scope, config, groupValue, cursor, 200);
      assertThat(r.status()).as(r.raw()).isEqualTo(200);
      for (JsonNode item : r.at("/items")) {
        out.add(item.at("/task/id").asText() + "|" + item.at("/group").asText());
      }
      cursor = r.at("/nextCursor").isNull() ? null : r.text("/nextCursor");
      assertThat(++pages).isLessThan(100);
    } while (cursor != null);
    return out;
  }

  private Map<String, Object> cfg(String group, String... sortKeys) {
    Map<String, Object> c = new LinkedHashMap<>();
    c.put("v", 1);
    if (group != null) {
      c.put("group", group);
    }
    List<Map<String, Object>> sorts = new ArrayList<>();
    for (String s : sortKeys) {
      String[] p = s.split("\\.");
      sorts.add(Map.of("key", p[0], "dir", p[1]));
    }
    if (!sorts.isEmpty()) {
      c.put("sort", sorts);
    }
    return c;
  }

  private Map<String, Object> spaceScope() {
    return Map.of("locationId", space);
  }

  @Test
  void everySortPagesTheSpaceWithoutDuplicatesOrGaps() {
    Set<String> expected = new HashSet<>();
    for (UUID list : lists) {
      for (String id : pageAll(ws.member(), Map.of("locationId", list), cfg(null), null)) {
        expected.add(id.split("\\|")[0]);
      }
    }
    assertThat(expected).hasSize(visibleTotal);
    for (String sort :
        List.of(
            "manual.asc",
            "title.asc",
            "title.desc",
            "status.asc",
            "priority.asc",
            "priority.desc",
            "dueDate.asc",
            "dueDate.desc",
            "startDate.asc",
            "createdAt.desc",
            "updatedAt.asc")) {
      List<String> ids = pageAll(ws.member(), spaceScope(), cfg(null, sort), null);
      assertThat(ids).as(sort).hasSize(visibleTotal);
      assertThat(new HashSet<>(ids)).as(sort).hasSize(visibleTotal);
      assertThat(
              ids.stream().map(s -> s.split("\\|")[0]).collect(java.util.stream.Collectors.toSet()))
          .as(sort)
          .isEqualTo(expected);
    }
    List<String> two =
        pageAll(ws.member(), spaceScope(), cfg(null, "dueDate.asc", "title.desc"), null);
    assertThat(new HashSet<>(two)).hasSize(visibleTotal);
  }

  @Test
  void everyGroupingPagesEachTaskOncePerGroup() {
    int i = 0;
    for (String group :
        List.of("status", "statusGroup", "priority", "assignee", "dueDate", "list")) {
      String sort = i++ % 2 == 0 ? "dueDate.desc" : "title.asc";
      List<String> rows = pageAll(ws.member(), spaceScope(), cfg(group, sort), null);
      Set<String> tasks = new HashSet<>();
      rows.forEach(r -> tasks.add(r.split("\\|")[0]));
      assertThat(tasks).as(group).hasSize(visibleTotal);
      if (group.equals("assignee")) {
        assertThat(new HashSet<>(rows)).as(group).hasSize(rows.size());
        assertThat(rows.size()).isGreaterThan(visibleTotal);
      } else {
        assertThat(rows).as(group).hasSize(visibleTotal);
      }
      // groups arrive contiguously: a group never reappears after another one started
      Set<String> closed = new HashSet<>();
      String current = null;
      for (String r : rows) {
        String g = r.split("\\|")[1];
        if (!g.equals(current)) {
          assertThat(closed).as(group + " contiguity").doesNotContain(g);
          if (current != null) {
            closed.add(current);
          }
          current = g;
        }
      }
      // group counts add up to the rows
      Resp first = query(ws.member(), spaceScope(), cfg(group, sort), null, null, 1);
      long sum = 0;
      for (JsonNode g : first.at("/groups")) {
        sum += g.get("count").asLong();
      }
      assertThat(sum).as(group + " counts").isEqualTo(rows.size());
    }
  }

  @Test
  void aBoardColumnPagesIndependentlyThroughGroupValue() {
    Resp first = query(ws.member(), spaceScope(), cfg("priority", "manual.asc"), null, null, 1);
    long urgent = 0;
    for (JsonNode g : first.at("/groups")) {
      if (g.get("key").asText().equals("URGENT")) {
        urgent = g.get("count").asLong();
      }
    }
    assertThat(urgent).isGreaterThan(0);
    List<String> rows = pageAll(ws.member(), spaceScope(), cfg("priority", "manual.asc"), "URGENT");
    assertThat(rows).hasSize((int) urgent);
    assertThat(new HashSet<>(rows)).hasSize((int) urgent);
    Resp assignee = query(ws.member(), spaceScope(), cfg("assignee"), "none", null, 200);
    assertThat(assignee.status()).isEqualTo(200);
    assertThat(query(ws.member(), spaceScope(), cfg("assignee"), "not-an-id", null, 10).status())
        .isEqualTo(400);
  }

  @Test
  void aTaskIsReturnedOncePerAssigneeGroup() {
    UUID both =
        jdbc.queryForObject(
            "SELECT t.id FROM task t JOIN task_assignee a ON a.task_id = t.id AND a.user_id = ?"
                + " JOIN task_assignee b ON b.task_id = t.id AND b.user_id = ? WHERE t.workspace_id = ?"
                + " AND t.deleted_at IS NULL AND t.list_id = ? LIMIT 1",
            UUID.class,
            ws.owner().id(),
            ws.member().id(),
            ws.id(),
            lists.get(1));
    List<String> rows = pageAll(ws.member(), spaceScope(), cfg("assignee"), null);
    assertThat(rows.stream().filter(r -> r.startsWith(both.toString())).toList()).hasSize(2);
  }

  @Test
  void privateArchivedAndTrashedTasksNeverAppear() {
    Set<String> privateIds =
        new HashSet<>(
            jdbc.queryForList(
                "SELECT id::text FROM task WHERE list_id = ?", String.class, privateList));
    Set<String> archivedIds =
        new HashSet<>(
            jdbc.queryForList(
                "SELECT id::text FROM task WHERE list_id = ?", String.class, archivedList));
    Set<String> trashed =
        new HashSet<>(
            jdbc.queryForList(
                "SELECT id::text FROM task WHERE workspace_id = ? AND deleted_at IS NOT NULL",
                String.class,
                ws.id()));
    for (TestUser user : List.of(ws.member(), ws.admin(), ws.owner())) {
      List<String> ids =
          pageAll(user, Map.of("workspaceId", ws.id()), cfg(null, "title.asc"), null).stream()
              .map(s -> s.split("\\|")[0])
              .toList();
      assertThat(ids).doesNotContainAnyElementsOf(archivedIds).doesNotContainAnyElementsOf(trashed);
      if (user != ws.member()) {
        assertThat(ids).containsAll(privateIds);
      } else {
        assertThat(ids).doesNotContainAnyElementsOf(privateIds);
      }
    }
    // a private list is a 404 for a member who asks for it directly
    assertThat(
            query(ws.member(), Map.of("locationId", privateList), cfg(null), null, null, 10)
                .status())
        .isEqualTo(404);
    // a guest with one granted list sees only that list at workspace scope
    put(
        "/api/v1/locations/" + lists.get(2) + "/grants/" + ws.guest().id(),
        ws.owner().token(),
        null);
    List<String> guestIds =
        pageAll(ws.guest(), Map.of("workspaceId", ws.id()), cfg(null), null).stream()
            .map(s -> s.split("\\|")[0])
            .toList();
    Set<String> gammaIds =
        new HashSet<>(
            jdbc.queryForList(
                "SELECT id::text FROM task WHERE list_id = ? AND deleted_at IS NULL",
                String.class,
                lists.get(2)));
    assertThat(new HashSet<>(guestIds)).isEqualTo(gammaIds);
  }

  @Test
  void aCursorReusedWithAnotherScopeOrConfigIsRefused() {
    Resp first = query(ws.member(), spaceScope(), cfg(null, "title.asc"), null, null, 10);
    String cursor = first.text("/nextCursor");
    Resp otherConfig = query(ws.member(), spaceScope(), cfg(null, "title.desc"), null, cursor, 10);
    assertThat(otherConfig.status()).isEqualTo(400);
    assertThat(otherConfig.text("/code")).isEqualTo("page.invalid_cursor");
    Resp otherScope =
        query(
            ws.member(),
            Map.of("locationId", lists.get(0)),
            cfg(null, "title.asc"),
            null,
            cursor,
            10);
    assertThat(otherScope.status()).isEqualTo(400);
    assertThat(
            query(ws.member(), spaceScope(), cfg(null, "title.asc"), null, "garbage", 10).status())
        .isEqualTo(400);
    assertThat(query(ws.member(), spaceScope(), cfg(null, "title.asc"), null, cursor, 10).status())
        .isEqualTo(200);
  }

  @Test
  void filtersNarrowTheResultAndAnInvalidConfigIs400() {
    Map<String, Object> config =
        Map.of(
            "v",
            1,
            "filter",
            Map.of(
                "op",
                "AND",
                "items",
                List.of(
                    Map.of("field", "priority", "op", "any_of", "value", List.of("URGENT")),
                    Map.of("field", "tag", "op", "any_of", "value", List.of("bug")),
                    Map.of(
                        "field", "assignee", "op", "any_of", "value", List.of(ws.owner().id())))));
    List<String> ids = pageAll(ws.member(), spaceScope(), config, null);
    Integer expected =
        jdbc.queryForObject(
            "SELECT count(*) FROM task t WHERE t.workspace_id = ? AND t.deleted_at IS NULL AND t.list_id = ANY"
                + " (?::uuid[]) AND t.priority = 'URGENT' AND t.number % 4 = 0 AND t.number % 3 = 0",
            Integer.class,
            ws.id(),
            "{"
                + lists.stream().map(UUID::toString).reduce((a, b) -> a + "," + b).orElseThrow()
                + "}");
    assertThat(ids).hasSize(expected);
    Resp bad =
        query(
            ws.member(),
            spaceScope(),
            Map.of("v", 1, "filter", Map.of("field", "x", "op", "any_of", "value", List.of("1"))),
            null,
            null,
            10);
    assertThat(bad.status()).isEqualTo(400);
    assertThat(bad.text("/code")).isEqualTo("view.invalid_config");
  }
}
