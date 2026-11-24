package com.taskflow.view.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("FIELD-3 filter, sort and group by custom fields")
class ViewCustomFieldQueryIT extends ViewTestBase {

  private Resp query(TestUser user, UUID location, Map<String, Object> config, Object... more) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("scope", location == null ? null : Map.of("locationId", location));
    body.put("config", config);
    for (int i = 0; i + 1 < more.length; i += 2) {
      body.put((String) more[i], more[i + 1]);
    }
    return post("/api/v1/views/query", user.token(), body);
  }

  private Resp workspaceQuery(TestUser user, UUID workspace, Map<String, Object> config) {
    return post(
        "/api/v1/views/query",
        user.token(),
        Map.of("scope", Map.of("workspaceId", workspace), "config", config));
  }

  private static Map<String, Object> cfg(Object filter, String group, Object sort) {
    Map<String, Object> c = new LinkedHashMap<>();
    c.put("v", 1);
    if (filter != null) {
      c.put("filter", filter);
    }
    if (group != null) {
      c.put("group", group);
    }
    if (sort != null) {
      c.put("sort", sort);
    }
    return c;
  }

  private static Map<String, Object> cond(UUID field, String op, Object value) {
    Map<String, Object> c = new LinkedHashMap<>();
    c.put("field", "cf:" + field);
    c.put("op", op);
    if (value != null) {
      c.put("value", value);
    }
    return c;
  }

  private static Map<String, Object> where(Map<String, Object> condition) {
    return Map.of("op", "AND", "items", List.of(condition));
  }

  private List<String> titles(Resp r) {
    assertThat(r.status()).as(r.raw()).isEqualTo(200);
    List<String> out = new ArrayList<>();
    r.at("/items").forEach(n -> out.add(n.at("/task/title").asText()));
    return out;
  }

  private UUID field(TestUser user, UUID location, String name, String type, String... options) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("name", name);
    body.put("type", type);
    if (options.length > 0) {
      body.put("options", java.util.Arrays.stream(options).map(o -> Map.of("name", o)).toList());
    }
    Resp r = post("/api/v1/locations/" + location + "/fields", user.token(), body);
    assertThat(r.status()).as(r.raw()).isEqualTo(201);
    return r.uuid("/id");
  }

  private UUID task(TestUser user, UUID list, String title, Map<String, Object> custom) {
    Resp r =
        post(
            "/api/v1/lists/" + list + "/tasks",
            user.token(),
            Map.of("title", title, "customFields", custom));
    assertThat(r.status()).as(r.raw()).isEqualTo(201);
    return r.uuid("/id");
  }

  // ---------------------------------------------------------------- operators

  @Test
  void eachOperatorFiltersAtSpaceFolderAndListScope() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID folder = folder(ws.member(), space, "F");
    UUID inFolder = list(ws.member(), folder, "L1");
    UUID inSpace = list(ws.member(), space, "L2");
    TestUser o = ws.owner();
    UUID tier = field(o, space, "Tier", "DROPDOWN", "Free", "Pro", "Enterprise");
    UUID tags = field(o, space, "Tags", "LABELS", "a", "b", "c");
    UUID points = field(o, space, "Points", "NUMBER");
    UUID due = field(o, space, "Due", "DATE");
    UUID notes = field(o, space, "Notes", "TEXT");
    UUID done = field(o, space, "Done", "CHECKBOX");
    UUID stars = field(o, space, "Stars", "RATING");
    UUID progress = field(o, space, "Progress", "PROGRESS");
    UUID link = field(o, space, "Link", "URL");
    UUID mail = field(o, space, "Mail", "EMAIL");

    task(
        ws.member(),
        inFolder,
        "t1",
        Map.of(
            tier.toString(),
            "Free",
            tags.toString(),
            List.of("a"),
            points.toString(),
            1,
            due.toString(),
            "2026-01-10",
            notes.toString(),
            "Alpha note",
            done.toString(),
            true,
            stars.toString(),
            1,
            progress.toString(),
            10,
            link.toString(),
            "https://a.example",
            mail.toString(),
            "a@x.com"));
    task(
        ws.member(),
        inFolder,
        "t2",
        Map.of(
            tier.toString(),
            "Pro",
            tags.toString(),
            List.of("a", "b"),
            points.toString(),
            5,
            due.toString(),
            "2026-02-10",
            notes.toString(),
            "beta",
            stars.toString(),
            3,
            progress.toString(),
            50,
            link.toString(),
            "https://b.example",
            mail.toString(),
            "b@y.com"));
    task(
        ws.member(),
        inSpace,
        "t3",
        Map.of(
            tier.toString(),
            "Enterprise",
            tags.toString(),
            List.of("c"),
            points.toString(),
            10,
            due.toString(),
            "2026-03-10",
            notes.toString(),
            "Gamma NOTE",
            done.toString(),
            true,
            stars.toString(),
            5,
            progress.toString(),
            100));
    task(ws.member(), inSpace, "t4", Map.of());

    Object[][] cases = {
      // field, op, value, expected titles at the Space
      {tier, "any_of", List.of("Pro", "Enterprise"), List.of("t2", "t3")},
      {tier, "none_of", List.of("Pro"), List.of("t1", "t3", "t4")},
      {tier, "is_set", null, List.of("t1", "t2", "t3")},
      {tier, "is_empty", null, List.of("t4")},
      {tags, "any_of", List.of("a"), List.of("t1", "t2")},
      {tags, "all_of", List.of("a", "b"), List.of("t2")},
      {tags, "none_of", List.of("a"), List.of("t3", "t4")},
      {tags, "is_empty", null, List.of("t4")},
      {points, "eq", 5, List.of("t2")},
      {points, "neq", 5, List.of("t1", "t3", "t4")},
      {points, "gt", 5, List.of("t3")},
      {points, "gte", 5, List.of("t2", "t3")},
      {points, "lt", 5, List.of("t1")},
      {points, "between", List.of(2, 10), List.of("t2", "t3")},
      {points, "is_empty", null, List.of("t4")},
      {due, "before", "2026-02-01", List.of("t1")},
      {due, "after", "2026-02-11", List.of("t3")},
      {due, "on", "2026-02-10", List.of("t2")},
      {due, "between", List.of("2026-01-01", "2026-02-28"), List.of("t1", "t2")},
      {due, "is_set", null, List.of("t1", "t2", "t3")},
      {notes, "contains", "NOTE", List.of("t1", "t3")},
      {notes, "not_contains", "note", List.of("t2", "t4")},
      {notes, "is_empty", null, List.of("t4")},
      {done, "is_checked", null, List.of("t1", "t3")},
      {done, "is_unchecked", null, List.of("t2", "t4")},
      {stars, "eq", 3, List.of("t2")},
      {stars, "gte", 3, List.of("t2", "t3")},
      {stars, "lte", 3, List.of("t1", "t2")},
      {progress, "gte", 50, List.of("t2", "t3")},
      {progress, "lte", 50, List.of("t1", "t2")},
      {progress, "between", List.of(20, 60), List.of("t2")},
      {link, "contains", "b.example", List.of("t2")},
      {link, "is_set", null, List.of("t1", "t2")},
      {mail, "contains", "@y.", List.of("t2")},
      {mail, "is_empty", null, List.of("t3", "t4")},
    };
    for (Object[] c : cases) {
      Map<String, Object> config =
          cfg(
              where(cond((UUID) c[0], (String) c[1], c[2])),
              null,
              List.of(Map.of("key", "title", "dir", "asc")));
      @SuppressWarnings("unchecked")
      List<String> expected = (List<String>) c[3];
      assertThat(titles(query(ws.member(), space, config)))
          .as("%s %s %s at Space", fieldName(c[0]), c[1], c[2])
          .containsExactlyElementsOf(expected);
      // The Folder sees only its two tasks; the same predicate, restricted.
      assertThat(titles(query(ws.member(), folder, config)))
          .as("%s %s %s at Folder", fieldName(c[0]), c[1], c[2])
          .containsExactlyElementsOf(
              expected.stream().filter(t -> t.equals("t1") || t.equals("t2")).toList());
      assertThat(titles(query(ws.member(), inSpace, config)))
          .as("%s %s %s at List", fieldName(c[0]), c[1], c[2])
          .containsExactlyElementsOf(
              expected.stream().filter(t -> t.equals("t3") || t.equals("t4")).toList());
    }
    // Workspace scope works the same way.
    assertThat(
            titles(
                workspaceQuery(
                    ws.member(),
                    ws.id(),
                    cfg(where(cond(tier, "any_of", List.of("Pro"))), null, null))))
        .containsExactly("t2");
  }

  private String fieldName(Object id) {
    return jdbc.queryForObject("SELECT name FROM custom_field WHERE id = ?", String.class, id);
  }

  @Test
  void wrongOperatorsValuesAndFieldsAreRefused() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    UUID points = field(ws.owner(), space, "Points", "NUMBER");
    UUID tags = field(ws.owner(), space, "Tags", "LABELS", "a");
    UUID longText = field(ws.owner(), space, "Long", "LONG_TEXT");
    for (Map<String, Object> bad :
        List.of(
            cfg(where(cond(points, "contains", "x")), null, null),
            cfg(where(cond(points, "eq", "x")), null, null),
            cfg(where(cond(points, "between", List.of(1))), null, null),
            cfg(where(cond(tags, "eq", 1)), null, null),
            cfg(where(cond(points, "is_set", 5)), null, null),
            cfg(null, "cf:" + points, null),
            cfg(null, null, List.of(Map.of("key", "cf:" + longText, "dir", "asc"))),
            cfg(null, null, List.of(Map.of("key", "cf:" + tags, "dir", "asc"))))) {
      Resp r = query(ws.member(), list, bad);
      assertThat(r.status()).as(r.raw()).isEqualTo(400);
      assertThat(r.text("/code")).isEqualTo("view.invalid_config");
    }
  }

  // ---------------------------------------------------------------- paging

  @Test
  void paging1000TasksSortedByNumberReturnsEachOnceWithEmptiesLast() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    UUID points = field(ws.owner(), space, "Points", "NUMBER");
    UUID status =
        jdbc.queryForObject(
            "SELECT id FROM status WHERE location_id = ? AND retired_at IS NULL ORDER BY rank LIMIT 1",
            UUID.class,
            space);
    jdbc.update(
        "INSERT INTO task (id, workspace_id, list_id, status_id, number, title, rank, created_by,"
            + " custom) SELECT gen_random_uuid(), ?, ?, ?, n, 'T' || n, 'r' || lpad(n::text, 6, '0'),"
            + " ?, CASE WHEN n % 10 = 0 THEN '{}'::jsonb ELSE jsonb_build_object(?, (n * 7) % 97 +"
            + " (n % 3) * 0.5) END FROM generate_series(1, 1000) n",
        ws.id(), list, status, ws.owner().id(), points.toString());

    for (String dir : List.of("asc", "desc")) {
      Map<String, Object> config =
          cfg(null, null, List.of(Map.of("key", "cf:" + points, "dir", dir)));
      List<Double> values = new ArrayList<>();
      Set<String> seen = new HashSet<>();
      String cursor = null;
      int pages = 0;
      do {
        Resp r =
            cursor == null
                ? query(ws.member(), list, config, "limit", 73)
                : query(ws.member(), list, config, "limit", 73, "cursor", cursor);
        assertThat(r.status()).as(r.raw()).isEqualTo(200);
        for (JsonNode item : r.at("/items")) {
          assertThat(seen.add(item.at("/task/id").asText())).as("duplicate").isTrue();
          JsonNode v = item.at("/task/customFields/" + points);
          values.add(v.isMissingNode() ? null : v.asDouble());
        }
        cursor =
            r.at("/nextCursor").isNull() || r.at("/nextCursor").isMissingNode()
                ? null
                : r.text("/nextCursor");
        pages++;
      } while (cursor != null && pages < 100);
      assertThat(seen).hasSize(1000);
      int firstEmpty = values.indexOf(null);
      assertThat(firstEmpty).as("empties start after every value (%s)", dir).isEqualTo(900);
      assertThat(values.subList(firstEmpty, values.size())).containsOnlyNulls();
      List<Double> filled = values.subList(0, firstEmpty);
      for (int i = 1; i < filled.size(); i++) {
        if (dir.equals("asc")) {
          assertThat(filled.get(i)).isGreaterThanOrEqualTo(filled.get(i - 1));
        } else {
          assertThat(filled.get(i)).isLessThanOrEqualTo(filled.get(i - 1));
        }
      }
    }
  }

  @Test
  void sortingByTextDropdownDateAndCheckboxKeepsEmptiesLast() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    UUID notes = field(ws.owner(), space, "Notes", "TEXT");
    UUID tier = field(ws.owner(), space, "Tier", "DROPDOWN", "Free", "Pro", "Enterprise");
    UUID due = field(ws.owner(), space, "Due", "DATE");
    UUID done = field(ws.owner(), space, "Done", "CHECKBOX");
    task(
        ws.member(),
        list,
        "a",
        Map.of(
            notes.toString(),
            "banana",
            tier.toString(),
            "Enterprise",
            due.toString(),
            "2026-03-01",
            done.toString(),
            true));
    task(
        ws.member(),
        list,
        "b",
        Map.of(notes.toString(), "Apple", tier.toString(), "Free", due.toString(), "2026-01-01"));
    task(ws.member(), list, "c", Map.of());
    task(
        ws.member(),
        list,
        "d",
        Map.of(notes.toString(), "cherry", tier.toString(), "Pro", due.toString(), "2026-02-01"));

    assertThat(
            titles(
                query(
                    ws.member(),
                    list,
                    cfg(null, null, List.of(Map.of("key", "cf:" + notes, "dir", "asc"))))))
        .containsExactly("b", "a", "d", "c");
    assertThat(
            titles(
                query(
                    ws.member(),
                    list,
                    cfg(null, null, List.of(Map.of("key", "cf:" + notes, "dir", "desc"))))))
        .containsExactly("d", "a", "b", "c");
    assertThat(
            titles(
                query(
                    ws.member(),
                    list,
                    cfg(null, null, List.of(Map.of("key", "cf:" + tier, "dir", "asc"))))))
        .containsExactly("b", "d", "a", "c");
    assertThat(
            titles(
                query(
                    ws.member(),
                    list,
                    cfg(null, null, List.of(Map.of("key", "cf:" + due, "dir", "asc"))))))
        .containsExactly("b", "d", "a", "c");
    assertThat(
            titles(
                query(
                    ws.member(),
                    list,
                    cfg(null, null, List.of(Map.of("key", "cf:" + due, "dir", "desc"))))))
        .containsExactly("a", "d", "b", "c");
    assertThat(
            titles(
                    query(
                        ws.member(),
                        list,
                        cfg(null, null, List.of(Map.of("key", "cf:" + done, "dir", "asc")))))
                .get(0))
        .isEqualTo("a");
  }

  // ---------------------------------------------------------------- group

  @Test
  void groupByDropdownListsLiveOptionsInOrderThenEmptyAndSurvivesARename() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    UUID tier = field(ws.owner(), space, "Tier", "DROPDOWN", "Free", "Pro", "Enterprise");
    task(ws.member(), list, "a", Map.of(tier.toString(), "Enterprise"));
    task(ws.member(), list, "b", Map.of(tier.toString(), "Free"));
    task(ws.member(), list, "c", Map.of());
    task(ws.member(), list, "d", Map.of(tier.toString(), "Free"));
    Map<String, Object> config =
        cfg(null, "cf:" + tier, List.of(Map.of("key", "title", "dir", "asc")));

    Resp r = query(ws.member(), list, config);
    assertThat(r.status()).as(r.raw()).isEqualTo(200);
    List<String> labels = new ArrayList<>();
    r.at("/groups")
        .forEach(g -> labels.add(g.get("label").asText() + ":" + g.get("count").asInt()));
    assertThat(labels).containsExactly("Free:2", "Enterprise:1", "None:1");
    assertThat(titles(r)).containsExactly("b", "d", "a", "c");

    JsonNode field = get("/api/v1/fields/" + tier, ws.owner().token()).json();
    UUID free = UUID.fromString(field.at("/options/0/id").asText());
    UUID pro = UUID.fromString(field.at("/options/1/id").asText());
    UUID ent = UUID.fromString(field.at("/options/2/id").asText());
    Resp renamed =
        patch(
            "/api/v1/fields/" + tier,
            ws.owner().token(),
            Map.of(
                "options",
                List.of(
                    Map.of("id", free, "name", "Starter"),
                    Map.of("id", pro, "name", "Pro"),
                    Map.of("id", ent, "name", "Enterprise"))),
            "If-Match",
            "\"1\"");
    assertThat(renamed.status()).as(renamed.raw()).isEqualTo(200);

    Resp after = query(ws.member(), list, config);
    assertThat(titles(after)).containsExactly("b", "d", "a", "c");
    assertThat(after.at("/groups/0/label").asText()).isEqualTo("Starter");
    assertThat(after.at("/groups/0/key").asText()).isEqualTo(free.toString());
    // One group page by its key.
    assertThat(titles(query(ws.member(), list, config, "groupValue", free.toString())))
        .containsExactly("b", "d");
    assertThat(titles(query(ws.member(), list, config, "groupValue", "none"))).containsExactly("c");
  }

  @Test
  void groupByCheckboxRatingAndDate() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    UUID done = field(ws.owner(), space, "Done", "CHECKBOX");
    UUID stars = field(ws.owner(), space, "Stars", "RATING");
    UUID due = field(ws.owner(), space, "Due", "DATE");
    task(
        ws.member(),
        list,
        "a",
        Map.of(done.toString(), true, stars.toString(), 4, due.toString(), "2020-01-01"));
    task(ws.member(), list, "b", Map.of(stars.toString(), 2));
    task(ws.member(), list, "c", Map.of());

    Resp checkbox = query(ws.member(), list, cfg(null, "cf:" + done, null));
    assertThat(checkbox.at("/groups/0/key").asText()).isEqualTo("checked");
    assertThat(checkbox.at("/groups/1/key").asText()).isEqualTo("unchecked");
    assertThat(checkbox.at("/groups/1/count").asInt()).isEqualTo(2);

    Resp rating = query(ws.member(), list, cfg(null, "cf:" + stars, null));
    List<String> keys = new ArrayList<>();
    rating.at("/groups").forEach(g -> keys.add(g.get("key").asText()));
    assertThat(keys).containsExactly("2", "4", "none");

    Resp date = query(ws.member(), list, cfg(null, "cf:" + due, null));
    List<String> buckets = new ArrayList<>();
    date.at("/groups").forEach(g -> buckets.add(g.get("key").asText()));
    assertThat(buckets).containsExactly("overdue", "none");
  }

  // ---------------------------------------------------------------- dropped and saved views

  @Test
  void aRetiredFieldIsDroppedAndNamedAndAnOutOfBranchFieldIsRefusedOnSave() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID other = space(ws.owner(), ws.id(), "Other");
    UUID list = list(ws.member(), space, "L");
    UUID points = field(ws.owner(), space, "Points", "NUMBER");
    UUID tier = field(ws.owner(), space, "Tier", "DROPDOWN", "Free");
    UUID foreign = field(ws.owner(), other, "Foreign", "TEXT");
    task(ws.member(), list, "a", Map.of(points.toString(), 1, tier.toString(), "Free"));
    task(ws.member(), list, "b", Map.of(points.toString(), 2));

    Map<String, Object> config =
        cfg(
            where(cond(points, "gt", 1)),
            "cf:" + tier,
            List.of(Map.of("key", "cf:" + points, "dir", "asc")));
    Resp live = query(ws.member(), list, config);
    assertThat(titles(live)).containsExactly("b");
    assertThat(live.at("/droppedFields").size()).isZero();

    assertThat(delete("/api/v1/fields/" + points, ws.owner().token(), "If-Match", "\"1\"").status())
        .isEqualTo(204);
    Resp dropped = query(ws.member(), list, config);
    assertThat(dropped.status()).as(dropped.raw()).isEqualTo(200);
    assertThat(titles(dropped)).containsExactlyInAnyOrder("a", "b");
    assertThat(dropped.at("/droppedFields/0/ref").asText()).isEqualTo("cf:" + points);
    assertThat(dropped.at("/droppedFields/0/name").asText()).isEqualTo("Points");
    // The grouping on the live field still applies.
    assertThat(dropped.at("/groups").size()).isGreaterThan(0);

    // A fully unknown id is dropped without a name.
    UUID ghost = UUID.randomUUID();
    Resp unknown = query(ws.member(), list, cfg(where(cond(ghost, "eq", 1)), null, null));
    assertThat(titles(unknown)).containsExactlyInAnyOrder("a", "b");
    assertThat(unknown.at("/droppedFields/0/name").isNull()).isTrue();

    // Saving: a live field of the branch is accepted, retired and out-of-branch ones are refused.
    assertThat(
            createView(
                    ws.member(),
                    list,
                    "ok",
                    "TABLE",
                    "SHARED",
                    cfg(where(cond(tier, "is_set", null)), null, null))
                .status())
        .isEqualTo(201);
    Resp retired =
        createView(
            ws.member(),
            list,
            "bad1",
            "TABLE",
            "SHARED",
            cfg(where(cond(points, "gt", 1)), null, null));
    assertThat(retired.status()).isEqualTo(400);
    assertThat(retired.text("/code")).isEqualTo("view.invalid_config");
    assertThat(
            createView(
                    ws.member(),
                    list,
                    "bad2",
                    "TABLE",
                    "SHARED",
                    cfg(where(cond(foreign, "is_set", null)), null, null))
                .status())
        .isEqualTo(400);
    // A field on a descendant of the scope is on the branch.
    UUID child = list(ws.member(), space, "Child");
    UUID onChild = field(ws.member(), child, "OnChild", "TEXT");
    assertThat(
            createView(
                    ws.owner(),
                    space,
                    "desc",
                    "TABLE",
                    "SHARED",
                    cfg(where(cond(onChild, "is_set", null)), null, null))
                .status())
        .isEqualTo(201);
  }

  // ---------------------------------------------------------------- scope guard (AD-1)

  @Test
  void aHiddenFieldAndAMovedTaskAreEmptyForFiltersSortsAndGroups() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID elsewhere = space(ws.owner(), ws.id(), "Elsewhere");
    UUID hiding = list(ws.member(), space, "Hiding");
    UUID plain = list(ws.member(), space, "Plain");
    UUID away = list(ws.member(), elsewhere, "Away");
    UUID tier = field(ws.owner(), space, "Tier", "DROPDOWN", "Free", "Pro");
    UUID points = field(ws.owner(), space, "Points", "NUMBER");
    task(ws.member(), plain, "visible", Map.of(tier.toString(), "Free", points.toString(), 3));
    UUID hiddenTask =
        task(ws.member(), hiding, "hidden", Map.of(tier.toString(), "Free", points.toString(), 1));
    UUID moved =
        task(ws.member(), plain, "moved", Map.of(tier.toString(), "Free", points.toString(), 2));
    // Hide Tier and Points at "Hiding"; move "moved" to a List outside the field's branch.
    for (UUID f : List.of(tier, points)) {
      assertThat(
              put(
                      "/api/v1/locations/" + hiding + "/fields/" + f + "/hidden",
                      ws.member().token(),
                      null)
                  .status())
          .isEqualTo(200);
    }
    long version = get("/api/v1/tasks/" + moved, ws.member().token()).at("/version").asLong();
    assertThat(
            post(
                    "/api/v1/tasks/" + moved + "/move",
                    ws.member().token(),
                    Map.of("listId", away),
                    "If-Match",
                    "\"" + version + "\"")
                .status())
        .isEqualTo(200);
    // The values are still stored.
    assertThat(
            jdbc.queryForObject(
                "SELECT custom::text FROM task WHERE id = ?", String.class, hiddenTask))
        .contains(tier.toString());

    for (String scope : List.of("space", "workspace")) {
      java.util.function.Function<Map<String, Object>, Resp> run =
          c ->
              scope.equals("space")
                  ? query(ws.member(), space, c)
                  : workspaceQuery(ws.member(), ws.id(), c);
      // any_of does not match the hidden or moved values.
      assertThat(titles(run.apply(cfg(where(cond(tier, "any_of", List.of("Free"))), null, null))))
          .as("any_of at %s", scope)
          .containsExactly("visible");
      // is_empty does.
      List<String> empty = titles(run.apply(cfg(where(cond(tier, "is_empty", null)), null, null)));
      assertThat(empty).as("is_empty at %s", scope).contains("hidden").doesNotContain("visible");
      // Sorted by Points, the guarded values sort as empties: visible first.
      List<String> sorted =
          titles(run.apply(cfg(null, null, List.of(Map.of("key", "cf:" + points, "dir", "asc")))));
      assertThat(sorted.get(0)).as("sort at %s", scope).isEqualTo("visible");
      // Grouped by Tier, hidden and moved tasks land in the empty group.
      Resp grouped = run.apply(cfg(null, "cf:" + tier, null));
      Map<String, String> groupOf = new LinkedHashMap<>();
      grouped
          .at("/items")
          .forEach(i -> groupOf.put(i.at("/task/title").asText(), i.get("group").asText()));
      assertThat(groupOf.get("visible")).as("group at %s", scope).isNotEqualTo("none");
      assertThat(groupOf.get("hidden")).isEqualTo("none");
    }
    // The moved task sits in a List outside the Space scope; at Workspace scope it is empty too.
    Resp ws1 =
        workspaceQuery(ws.member(), ws.id(), cfg(where(cond(tier, "is_empty", null)), null, null));
    assertThat(titles(ws1)).contains("moved", "hidden");
    assertThat(
            titles(
                workspaceQuery(
                    ws.member(),
                    ws.id(),
                    cfg(where(cond(tier, "any_of", List.of("Free"))), null, null))))
        .doesNotContain("moved", "hidden");
  }

  @Test
  void anOptionNameWithQuotesAndPercentIsMatchedLiterally() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    UUID tier = field(ws.owner(), space, "Tier", "DROPDOWN", "100% 'quoted' \"x\"", "other");
    UUID notes = field(ws.owner(), space, "Notes", "TEXT");
    task(
        ws.member(),
        list,
        "a",
        Map.of(
            tier.toString(),
            "100% 'quoted' \"x\"",
            notes.toString(),
            "50% off'; DROP TABLE task;--"));
    task(ws.member(), list, "b", Map.of(tier.toString(), "other", notes.toString(), "5000 off"));
    assertThat(
            titles(
                query(
                    ws.member(),
                    list,
                    cfg(where(cond(tier, "any_of", List.of("100% 'quoted' \"x\""))), null, null))))
        .containsExactly("a");
    assertThat(
            titles(
                query(ws.member(), list, cfg(where(cond(notes, "contains", "50%")), null, null))))
        .containsExactly("a");
    assertThat(
            titles(
                query(
                    ws.member(), list, cfg(where(cond(notes, "contains", "'; DROP")), null, null))))
        .containsExactly("a");
  }
}
