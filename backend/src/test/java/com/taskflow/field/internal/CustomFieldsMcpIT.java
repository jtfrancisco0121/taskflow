package com.taskflow.field.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.identity.internal.McpTestBase;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("MCP custom fields: list, create, update, get and search with an API key")
class CustomFieldsMcpIT extends McpTestBase {

  private record Fix(Ws ws, UUID space, UUID list, Agent agent, UUID tier, UUID points) {}

  private Fix fixture() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.owner(), space, "L");
    UUID tier = createField(ws, space, "Customer tier", "DROPDOWN", "Free", "Pro", "Enterprise");
    UUID points = createField(ws, space, "Story points", "NUMBER");
    return new Fix(
        ws, space, list, agent(ws.admin(), ws.id(), "triage-agent", "CI-1"), tier, points);
  }

  private UUID createField(Ws ws, UUID location, String name, String type, String... options) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("name", name);
    body.put("type", type);
    if (options.length > 0) {
      body.put("options", java.util.Arrays.stream(options).map(o -> Map.of("name", o)).toList());
    }
    Resp r = post("/api/v1/locations/" + location + "/fields", ws.owner().token(), body);
    assertThat(r.status()).as(r.raw()).isEqualTo(201);
    return r.uuid("/id");
  }

  private ToolResult create(
      Fix f, UUID list, String title, Map<String, Object> custom, Object... more) {
    Map<String, Object> args = new LinkedHashMap<>();
    args.put("listId", list.toString());
    args.put("title", title);
    args.put("customFields", custom);
    for (int i = 0; i + 1 < more.length; i += 2) {
      args.put((String) more[i], more[i + 1]);
    }
    return call(f.agent().secret(), "create_task", args);
  }

  private ToolResult search(Fix f, Map<String, Object> args) {
    return call(f.agent().secret(), "search_tasks", args);
  }

  private static Map<String, Object> cond(UUID field, String op, Object value) {
    Map<String, Object> c = new LinkedHashMap<>();
    c.put("fieldId", field.toString());
    c.put("op", op);
    if (value != null) {
      c.put("value", value);
    }
    return c;
  }

  private List<String> titles(ToolResult r) {
    assertThat(r.isError()).as(r.body().toString()).isFalse();
    List<String> out = new ArrayList<>();
    r.body().at("/items").forEach(n -> out.add(n.get("title").asText()));
    return out;
  }

  // ---------------------------------------------------------------- flow

  @Test
  void anAgentListsFieldsCreatesWithValuesFindsThemReadsThemAndUpdatesOne() {
    Fix f = fixture();
    String key = f.agent().secret();

    ToolResult fields = call(key, "list_custom_fields", Map.of("locationId", f.list().toString()));
    assertThat(fields.isError()).isFalse();
    assertThat(fields.body().at("/fields/0/name").asText()).isEqualTo("Customer tier");
    assertThat(fields.body().at("/fields/0/type").asText()).isEqualTo("DROPDOWN");
    assertThat(fields.body().at("/fields/0/definedAt").asText()).isEqualTo(f.space().toString());
    assertThat(fields.body().at("/fields/0/options/2/name").asText()).isEqualTo("Enterprise");
    assertThat(fields.body().at("/fields/0/inherited").asBoolean()).isTrue();
    assertThat(fields.body().at("/fields/1/type").asText()).isEqualTo("NUMBER");

    // Dropdown by Option name, Number by value, the field by id and by name.
    ToolResult created =
        create(
            f,
            f.list(),
            "Found by value",
            Map.of(f.tier().toString(), "Enterprise", "story points", 3));
    assertThat(created.isError()).as(created.body().toString()).isFalse();
    UUID id = UUID.fromString(created.body().get("id").asText());
    assertThat(created.body().at("/customFields/" + f.points()).asInt()).isEqualTo(3);
    create(f, f.list(), "Not enterprise", Map.of(f.tier().toString(), "Free"));
    create(f, f.list(), "No values", Map.of());

    // search_tasks filtered on the Dropdown finds it, with and without a Location scope.
    assertThat(
            titles(
                search(
                    f,
                    Map.of(
                        "customFields", List.of(cond(f.tier(), "any_of", List.of("Enterprise")))))))
        .containsExactly("Found by value");
    assertThat(
            titles(
                search(
                    f,
                    Map.of(
                        "locationId",
                        f.list().toString(),
                        "customFields",
                        List.of(cond(f.tier(), "is_set", null))))))
        .containsExactlyInAnyOrder("Found by value", "Not enterprise");
    assertThat(
            titles(
                search(
                    f,
                    Map.of(
                        "locationId",
                        f.space().toString(),
                        "customFields",
                        List.of(
                            cond(f.tier(), "any_of", List.of("enterprise")),
                            cond(f.points(), "gte", 3))))))
        .containsExactly("Found by value");

    // get_task returns the values.
    ToolResult got = call(key, "get_task", Map.of("taskId", id.toString()));
    assertThat(got.body().at("/customFields/" + f.tier()).asText()).isNotBlank();
    assertThat(got.body().at("/customFields/" + f.points()).asInt()).isEqualTo(3);

    // update_task changes one value and leaves the other.
    long version = got.body().get("version").asLong();
    ToolResult updated =
        call(
            key,
            "update_task",
            Map.of(
                "taskId",
                id.toString(),
                "version",
                version,
                "customFields",
                Map.of(f.points().toString(), 8)));
    assertThat(updated.isError()).as(updated.body().toString()).isFalse();
    assertThat(updated.body().at("/customFields/" + f.points()).asInt()).isEqualTo(8);
    assertThat(updated.body().at("/customFields/" + f.tier()).asText())
        .isEqualTo(got.body().at("/customFields/" + f.tier()).asText());
    assertThat(updated.body().get("version").asLong()).isEqualTo(version + 1);
    // Attributed to the service account and its key.
    Map<String, Object> row =
        jdbc.queryForMap(
            "SELECT actor_type, actor_key_id FROM activity_event WHERE entity_id = ? AND type = 'task.updated'",
            id);
    assertThat(row.get("actor_type")).isEqualTo("SERVICE_ACCOUNT");
    assertThat(row.get("actor_key_id")).isEqualTo(f.agent().keyId());
  }

  @Test
  void anUnknownOptionFailsNamingTheFieldAndTheValidOptions() {
    Fix f = fixture();
    ToolResult create = create(f, f.list(), "Gold", Map.of(f.tier().toString(), "Gold"));
    assertThat(create.isError()).isTrue();
    assertThat(create.body().toString())
        .contains("Customer tier")
        .contains("Free, Pro, Enterprise");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM task WHERE list_id = ?", Integer.class, f.list()))
        .isZero();
    ToolResult searched =
        search(f, Map.of("customFields", List.of(cond(f.tier(), "any_of", List.of("Gold")))));
    assertThat(searched.isError()).isTrue();
    assertThat(searched.body().toString())
        .contains("Customer tier")
        .contains("Free, Pro, Enterprise");
    ToolResult badOp =
        search(f, Map.of("customFields", List.of(cond(f.points(), "contains", "x"))));
    assertThat(badOp.isError()).isTrue();
  }

  // ---------------------------------------------------------------- idempotency (decision 005.11)

  @Test
  void aRetriedCreateAndUpdateWithTheSameKeyApplyOnce() {
    Fix f = fixture();
    String key = f.agent().secret();
    String createKey = UUID.randomUUID().toString();
    Map<String, Object> custom = Map.of(f.points().toString(), 5);
    ToolResult first = create(f, f.list(), "Once", custom, "idempotencyKey", createKey);
    ToolResult retry = create(f, f.list(), "Once", custom, "idempotencyKey", createKey);
    assertThat(first.isError()).isFalse();
    assertThat(retry.body()).isEqualTo(first.body());
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM task WHERE list_id = ?", Integer.class, f.list()))
        .isEqualTo(1);
    UUID id = UUID.fromString(first.body().get("id").asText());

    String updateKey = UUID.randomUUID().toString();
    Map<String, Object> args = new LinkedHashMap<>();
    args.put("taskId", id.toString());
    args.put("version", first.body().get("version").asLong());
    args.put("customFields", Map.of(f.points().toString(), 9));
    args.put("idempotencyKey", updateKey);
    ToolResult one = call(key, "update_task", args);
    ToolResult two = call(key, "update_task", args);
    assertThat(one.isError()).as(one.body().toString()).isFalse();
    assertThat(two.body()).isEqualTo(one.body());
    assertThat(one.body().get("version").asLong()).isEqualTo(2);
    assertThat(jdbc.queryForObject("SELECT version FROM task WHERE id = ?", Long.class, id))
        .isEqualTo(2);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM activity_event WHERE entity_id = ? AND type = 'task.updated'",
                Integer.class,
                id))
        .isEqualTo(1);

    // The same key with other arguments is refused.
    args.put("customFields", Map.of(f.points().toString(), 10));
    ToolResult reused = call(key, "update_task", args);
    assertThat(reused.isError()).isTrue();
    assertThat(reused.body().toString()).contains("idempotency.key_reused");
    ToolResult createReused = create(f, f.list(), "Other", custom, "idempotencyKey", createKey);
    assertThat(createReused.isError()).isTrue();
    assertThat(createReused.body().toString()).contains("idempotency.key_reused");
  }

  // ---------------------------------------------------------------- search behaviour

  @Test
  void aSearchWithNeitherQueryNorConditionsIsRefusedAndAQueryOnlyCallStillWorks() {
    Fix f = fixture();
    create(f, f.list(), "Needle in a haystack", Map.of());
    ToolResult none = search(f, Map.of());
    assertThat(none.isError()).isTrue();
    assertThat(none.body().toString()).contains("tool.invalid_argument");
    ToolResult locationOnly = search(f, Map.of("locationId", f.list().toString()));
    assertThat(locationOnly.isError()).isTrue();
    // Only a query: the existing text search.
    ToolResult text = search(f, Map.of("query", "needle"));
    assertThat(titles(text)).containsExactly("Needle in a haystack");
    assertThat(text.body().at("/items/0/snippet").asText()).contains("<mark>");
  }

  @Test
  void conditionsOnlyCallsPageByUpdatedAtDescendingEveryMatchOnceAndRefuseARankedCursor() {
    Fix f = fixture();
    List<UUID> ids = new ArrayList<>();
    for (int i = 0; i < 12; i++) {
      ToolResult r = create(f, f.list(), "Task " + i, Map.of(f.tier().toString(), "Pro"));
      ids.add(UUID.fromString(r.body().get("id").asText()));
    }
    create(f, f.list(), "Other tier", Map.of(f.tier().toString(), "Free"));
    // Distinct update times, newest = Task 11, with a tie broken by id.
    for (int i = 0; i < ids.size(); i++) {
      jdbc.update(
          "UPDATE task SET updated_at = timestamptz '2026-01-01' + ? * interval '1 hour' WHERE id = ?",
          i / 2, // pairs of tasks share a timestamp: the id breaks the tie
          ids.get(i));
    }
    List<String> seen = new ArrayList<>();
    Set<String> distinct = new HashSet<>();
    String cursor = null;
    int pages = 0;
    do {
      Map<String, Object> args = new LinkedHashMap<>();
      args.put("customFields", List.of(cond(f.tier(), "any_of", List.of("Pro"))));
      args.put("limit", 5);
      if (cursor != null) {
        args.put("cursor", cursor);
      }
      ToolResult r = search(f, args);
      assertThat(r.isError()).as(r.body().toString()).isFalse();
      r.body()
          .at("/items")
          .forEach(n -> {
            seen.add(n.get("title").asText());
            distinct.add(n.get("taskId").asText());
          });
      JsonNode next = r.body().get("nextCursor");
      cursor = next == null || next.isNull() ? null : next.asText();
      pages++;
    } while (cursor != null && pages < 10);
    assertThat(pages).isEqualTo(3);
    assertThat(seen).hasSize(12);
    assertThat(distinct).hasSize(12);
    // updated_at DESC: the pair of Task 10 and 11 first, Task 0 and 1 last.
    assertThat(seen.subList(0, 2)).containsExactlyInAnyOrder("Task 10", "Task 11");
    assertThat(seen.subList(10, 12)).containsExactlyInAnyOrder("Task 0", "Task 1");

    // A ranked cursor (from a text search) is refused by a conditions-only call, and the reverse.
    for (int i = 0; i < 25; i++) {
      create(f, f.list(), "Findme " + i, Map.of());
    }
    ToolResult ranked = search(f, Map.of("query", "findme", "limit", 5));
    String rankedCursor = ranked.body().get("nextCursor").asText();
    ToolResult refused =
        search(
            f,
            Map.of(
                "customFields", List.of(cond(f.tier(), "is_set", null)), "cursor", rankedCursor));
    assertThat(refused.isError()).isTrue();
    assertThat(refused.body().toString()).contains("page.invalid_cursor");
    Map<String, Object> firstPage = new LinkedHashMap<>();
    firstPage.put("customFields", List.of(cond(f.tier(), "is_set", null)));
    firstPage.put("limit", 2);
    String updatedCursor = search(f, firstPage).body().get("nextCursor").asText();
    ToolResult reverse = search(f, Map.of("query", "findme", "cursor", updatedCursor));
    assertThat(reverse.isError()).isTrue();
    assertThat(reverse.body().toString()).contains("page.invalid_cursor");
  }

  @Test
  void aQueryTogetherWithConditionsRanksByRelevanceAndFilters() {
    Fix f = fixture();
    create(f, f.list(), "Pricing page bug", Map.of(f.tier().toString(), "Enterprise"));
    create(f, f.list(), "Pricing page typo", Map.of(f.tier().toString(), "Free"));
    create(f, f.list(), "Unrelated", Map.of(f.tier().toString(), "Enterprise"));
    ToolResult r =
        search(
            f,
            Map.of(
                "query",
                "pricing",
                "customFields",
                List.of(cond(f.tier(), "any_of", List.of("Enterprise")))));
    assertThat(titles(r)).containsExactly("Pricing page bug");
    assertThat(r.body().at("/items/0/snippet").asText()).contains("<mark>");
    ToolResult scoped =
        search(
            f,
            Map.of(
                "query",
                "pricing",
                "locationId",
                f.list().toString(),
                "customFields",
                List.of(cond(f.tier(), "is_set", null))));
    assertThat(titles(scoped)).containsExactlyInAnyOrder("Pricing page bug", "Pricing page typo");
  }

  @Test
  void hiddenAndLeftBehindValuesAreNotMatched() {
    Fix f = fixture();
    UUID hiding = list(f.ws().owner(), f.space(), "Hiding");
    UUID away = list(f.ws().owner(), space(f.ws().owner(), f.ws().id(), "Elsewhere"), "Away");
    create(f, f.list(), "visible", Map.of(f.tier().toString(), "Pro"));
    create(f, hiding, "hidden below", Map.of(f.tier().toString(), "Pro"));
    ToolResult moved = create(f, f.list(), "moved away", Map.of(f.tier().toString(), "Pro"));
    assertThat(
            put(
                    "/api/v1/locations/" + hiding + "/fields/" + f.tier() + "/hidden",
                    f.ws().owner().token(),
                    null)
                .status())
        .isEqualTo(200);
    UUID movedId = UUID.fromString(moved.body().get("id").asText());
    ToolResult moveResult =
        call(
            f.agent().secret(),
            "move_task",
            Map.of("taskId", movedId.toString(), "listId", away.toString()));
    assertThat(moveResult.isError()).as(moveResult.body().toString()).isFalse();

    assertThat(
            titles(
                search(
                    f, Map.of("customFields", List.of(cond(f.tier(), "any_of", List.of("Pro")))))))
        .containsExactly("visible");
    assertThat(titles(search(f, Map.of("customFields", List.of(cond(f.tier(), "is_empty", null))))))
        .containsExactlyInAnyOrder("hidden below", "moved away");
  }

  @Test
  void trashedTasksAndTasksInArchivedListsAreNeverReturned() {
    Fix f = fixture();
    UUID archived = list(f.ws().owner(), f.space(), "Old");
    create(f, f.list(), "live", Map.of(f.tier().toString(), "Pro"));
    ToolResult trashed = create(f, f.list(), "trashed", Map.of(f.tier().toString(), "Pro"));
    create(f, archived, "in archived list", Map.of(f.tier().toString(), "Pro"));
    UUID trashedId = UUID.fromString(trashed.body().get("id").asText());
    assertThat(
            call(f.agent().secret(), "delete_task", Map.of("taskId", trashedId.toString()))
                .isError())
        .isFalse();
    assertThat(
            post("/api/v1/locations/" + archived + "/archive", f.ws().owner().token(), null)
                .status())
        .isEqualTo(200);

    Map<String, Object> pro =
        Map.of("customFields", List.of(cond(f.tier(), "any_of", List.of("Pro"))));
    assertThat(titles(search(f, pro))).containsExactly("live");
    // With a query and a scope the same base filters hold.
    assertThat(
            titles(
                search(
                    f,
                    Map.of(
                        "query",
                        "trashed",
                        "customFields",
                        List.of(cond(f.tier(), "any_of", List.of("Pro")))))))
        .isEmpty();
    assertThat(
            titles(
                search(
                    f,
                    Map.of(
                        "locationId",
                        archived.toString(),
                        "customFields",
                        List.of(cond(f.tier(), "is_set", null))))))
        .isEmpty();
  }

  @Test
  void anOptionNameWithQuoteAndPercentIsMatchedLiterally() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.owner(), space, "L");
    String weird = "100% 'sure'";
    UUID tier = createField(ws, space, "Weird", "DROPDOWN", weird, "other");
    Fix f = new Fix(ws, space, list, agent(ws.admin(), ws.id(), "bot", "k"), tier, tier);
    create(f, list, "match", Map.of(tier.toString(), weird));
    create(f, list, "no match", Map.of(tier.toString(), "other"));
    assertThat(
            titles(
                search(f, Map.of("customFields", List.of(cond(tier, "any_of", List.of(weird)))))))
        .containsExactly("match");
    ToolResult injected =
        search(f, Map.of("customFields", List.of(cond(tier, "any_of", List.of("x') OR 1=1 --")))));
    assertThat(injected.isError()).isTrue();
  }

  @Test
  void aPeopleValueIsGivenAsUserIdsAndFoundBySearch() {
    Fix f = fixture();
    UUID reviewer = createField(f.ws(), f.space(), "Reviewer", "PEOPLE");
    String member = f.ws().member().id().toString();
    ToolResult fields =
        call(f.agent().secret(), "list_custom_fields", Map.of("locationId", f.list().toString()));
    assertThat(fields.body().toString()).contains("\"type\":\"PEOPLE\"");
    ToolResult created = create(f, f.list(), "Reviewed", Map.of("Reviewer", List.of(member)));
    assertThat(created.isError()).as(created.body().toString()).isFalse();
    assertThat(created.body().at("/customFields/" + reviewer + "/0").asText()).isEqualTo(member);
    ToolResult bad =
        create(f, f.list(), "Bad", Map.of("Reviewer", List.of(UUID.randomUUID().toString())));
    assertThat(bad.isError()).isTrue();
    assertThat(bad.body().toString()).contains("Reviewer");
    assertThat(
            titles(
                search(
                    f, Map.of("customFields", List.of(cond(reviewer, "any_of", List.of(member)))))))
        .containsExactly("Reviewed");
  }
}
