package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.identity.internal.ServiceAccountTestBase;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("FIELD custom field values on tasks")
class TaskCustomFieldsIT extends ServiceAccountTestBase {

  private record Fix(Ws ws, UUID space, UUID list) {}

  private Fix fixture() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    return new Fix(ws, space, list(ws.member(), space, "L"));
  }

  private UUID field(TestUser user, UUID location, String name, String type, String... options) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("name", name);
    body.put("type", type);
    if (options.length > 0) {
      List<Map<String, Object>> list = new ArrayList<>();
      for (String o : options) {
        list.add(Map.of("name", o));
      }
      body.put("options", list);
    }
    Resp r = post("/api/v1/locations/" + location + "/fields", user.token(), body);
    assertThat(r.status()).as(r.raw()).isEqualTo(201);
    return r.uuid("/id");
  }

  private Resp createTask(TestUser user, UUID list, Map<String, Object> custom) {
    return post(
        "/api/v1/lists/" + list + "/tasks",
        user.token(),
        Map.of("title", "T", "customFields", custom));
  }

  private Resp setValue(TestUser user, UUID task, Object fieldKey, Object value) {
    Map<String, Object> custom = new LinkedHashMap<>();
    custom.put(String.valueOf(fieldKey), value);
    return patchTask(user, task, currentVersion(user, task), Map.of("customFields", custom));
  }

  private long currentVersion(TestUser user, UUID task) {
    return get("/api/v1/tasks/" + task, user.token()).at("/version").asLong();
  }

  private JsonNode stored(UUID task) {
    try {
      return mapper.readTree(
          jdbc.queryForObject("SELECT custom::text FROM task WHERE id = ?", String.class, task));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private String storedText(UUID task) {
    return jdbc.queryForObject("SELECT custom::text FROM task WHERE id = ?", String.class, task);
  }

  private int count(String table, String type, UUID entity) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM " + table + " WHERE entity_id = ? AND type = ?",
        Integer.class,
        entity,
        type);
  }

  // ---------------------------------------------------------------- per-type validation

  @Test
  void everyTypeAcceptsItsValidValuesAndRejectsInvalidOnes() {
    Fix f = fixture();
    UUID text = field(f.ws().owner(), f.space(), "Text", "TEXT");
    UUID longText = field(f.ws().owner(), f.space(), "Long", "LONG_TEXT");
    UUID number = field(f.ws().owner(), f.space(), "Number", "NUMBER");
    UUID date = field(f.ws().owner(), f.space(), "Date", "DATE");
    UUID dropdown = field(f.ws().owner(), f.space(), "Tier", "DROPDOWN", "Free", "Pro");
    UUID labels = field(f.ws().owner(), f.space(), "Labels", "LABELS", "a", "b");
    UUID checkbox = field(f.ws().owner(), f.space(), "Check", "CHECKBOX");
    UUID url = field(f.ws().owner(), f.space(), "Url", "URL");
    UUID email = field(f.ws().owner(), f.space(), "Email", "EMAIL");
    UUID rating = field(f.ws().owner(), f.space(), "Rating", "RATING");
    UUID progress = field(f.ws().owner(), f.space(), "Progress", "PROGRESS");
    UUID task = task(f.ws().member(), f.list(), "T");

    Object[][] valid = {
      {text, "  hello  ", "hello"},
      {longText, "x".repeat(10000), "x".repeat(10000)},
      {number, 12.5, 12.5},
      {number, -3, -3},
      {date, "2026-12-31", "2026-12-31T00:00:00Z"},
      {date, "2026-12-31T17:45:00Z", "2026-12-31T00:00:00Z"},
      {dropdown, "pro", null},
      {checkbox, true, true},
      {url, "https://example.com/a?b=1", "https://example.com/a?b=1"},
      {email, "Ann@Example.COM", "Ann@example.com"},
      {rating, 4, 4},
      {progress, 40, 40},
      {progress, 0, 0},
    };
    for (Object[] c : valid) {
      Resp r = setValue(f.ws().member(), task, c[0], c[1]);
      assertThat(r.status()).as("%s <- %s: %s", c[0], c[1], r.raw()).isEqualTo(200);
      if (c[2] != null) {
        assertThat((JsonNode) mapper.valueToTree(c[2]))
            .as("%s <- %s", c[0], c[1])
            .isEqualTo(r.at("/customFields/" + c[0]));
      }
    }
    Resp tags = setValue(f.ws().member(), task, labels, List.of("a", "B"));
    assertThat(tags.status()).as(tags.raw()).isEqualTo(200);
    assertThat(tags.at("/customFields/" + labels).size()).isEqualTo(2);

    Object[][] invalid = {
      {text, 5},
      {text, "   "},
      {text, "x".repeat(2001)},
      {longText, "x".repeat(10001)},
      {number, "12"},
      {number, 1e15},
      {date, "31/12/2026"},
      {date, 5},
      {dropdown, "Gold"},
      {dropdown, 3},
      {labels, "a"},
      {labels, List.of("a", "a")},
      {labels, List.of("nope")},
      {checkbox, "yes"},
      {url, "ftp://example.com"},
      {url, "javascript:alert(1)"},
      {url, "example.com"},
      {email, "no-at-sign"},
      {email, "a@b@c.com"},
      {email, "@example.com"},
      {rating, 6},
      {rating, 2.5},
      {rating, -1},
      {progress, 101},
      {progress, -1},
      {progress, "50"},
    };
    for (Object[] c : invalid) {
      Resp r = setValue(f.ws().member(), task, c[0], c[1]);
      assertThat(r.status()).as("%s <- %s", c[0], c[1]).isEqualTo(400);
      assertThat(r.text("/code")).isEqualTo("field.invalid_value");
      assertThat(r.text("/detail")).contains(fieldName(c[0]));
    }
  }

  private String fieldName(Object id) {
    return jdbc.queryForObject(
        "SELECT name FROM custom_field WHERE id = ?", String.class, UUID.fromString(id.toString()));
  }

  @Test
  void aBadDropdownNameListsTheValidOptions() {
    Fix f = fixture();
    UUID tier = field(f.ws().owner(), f.space(), "Customer tier", "DROPDOWN", "Free", "Pro");
    UUID task = task(f.ws().member(), f.list(), "T");
    Resp r = setValue(f.ws().member(), task, tier, "Gold");
    assertThat(r.status()).isEqualTo(400);
    assertThat(r.text("/detail")).contains("Customer tier").contains("Free, Pro");
  }

  @Test
  void nullAndFalseAndZeroClearAndAFieldNameWorksAsKey() {
    Fix f = fixture();
    UUID tier = field(f.ws().owner(), f.space(), "Customer tier", "DROPDOWN", "Free", "Pro");
    UUID check = field(f.ws().owner(), f.space(), "Done", "CHECKBOX");
    UUID rating = field(f.ws().owner(), f.space(), "Stars", "RATING");
    UUID task = task(f.ws().member(), f.list(), "T");

    // The Option is given by name and stored as its id; the field by name too.
    Resp set = setValue(f.ws().member(), task, "customer TIER", "Pro");
    assertThat(set.status()).as(set.raw()).isEqualTo(200);
    String proId =
        jdbc.queryForObject(
            "SELECT id::text FROM custom_field_option WHERE name = 'Pro' AND field_id = ?",
            String.class,
            tier);
    assertThat(stored(task).get(tier.toString()).asText()).isEqualTo(proId);
    assertThat(set.at("/customFields/" + tier).asText()).isEqualTo(proId);

    setValue(f.ws().member(), task, check, true);
    setValue(f.ws().member(), task, rating, 3);
    assertThat(stored(task).size()).isEqualTo(3);
    assertThat(setValue(f.ws().member(), task, check, false).status()).isEqualTo(200);
    assertThat(setValue(f.ws().member(), task, rating, 0).status()).isEqualTo(200);
    assertThat(setValue(f.ws().member(), task, tier, null).status()).isEqualTo(200);
    assertThat(stored(task).size()).isZero();
    assertThat(read(f.ws().member(), task).at("/customFields").size()).isZero();
  }

  private JsonNode read(TestUser user, UUID task) {
    return get("/api/v1/tasks/" + task, user.token()).json();
  }

  @Test
  void aFieldThatIsNotEffectiveOnTheListIsRefused() {
    Fix f = fixture();
    UUID elsewhere = space(f.ws().owner(), f.ws().id(), "Elsewhere");
    UUID foreign = field(f.ws().owner(), elsewhere, "Foreign", "TEXT");
    UUID hiding = field(f.ws().owner(), f.space(), "Hide me", "TEXT");
    UUID task = task(f.ws().member(), f.list(), "T");
    assertThat(
            put(
                    "/api/v1/locations/" + f.list() + "/fields/" + hiding + "/hidden",
                    f.ws().member().token(),
                    null)
                .status())
        .isEqualTo(200);

    Resp r1 = setValue(f.ws().member(), task, foreign, "x");
    assertThat(r1.status()).isEqualTo(400);
    assertThat(r1.text("/code")).isEqualTo("field.not_available");
    assertThat(setValue(f.ws().member(), task, hiding, "x").text("/code"))
        .isEqualTo("field.not_available");
    assertThat(setValue(f.ws().member(), task, UUID.randomUUID(), "x").text("/code"))
        .isEqualTo("field.not_available");
    assertThat(createTask(f.ws().member(), f.list(), Map.of(hiding.toString(), "x")).status())
        .isEqualTo(400);
  }

  @Test
  void createStoresValidatedValuesAndSeveralFieldsBumpTheVersionOnce() {
    Fix f = fixture();
    UUID a = field(f.ws().owner(), f.space(), "A", "NUMBER");
    UUID b = field(f.ws().owner(), f.space(), "B", "TEXT");
    Resp created =
        createTask(f.ws().member(), f.list(), Map.of(a.toString(), 5, b.toString(), "hi"));
    assertThat(created.status()).as(created.raw()).isEqualTo(201);
    UUID task = created.uuid("/id");
    assertThat(created.at("/customFields/" + a).asInt()).isEqualTo(5);
    assertThat(created.at("/version").asInt()).isEqualTo(1);
    assertThat(createTask(f.ws().member(), f.list(), Map.of(a.toString(), "five")).status())
        .isEqualTo(400);

    Resp both =
        patchTask(
            f.ws().member(),
            task,
            1,
            Map.of("customFields", Map.of(a.toString(), 6, b.toString(), "bye")));
    assertThat(both.status()).isEqualTo(200);
    assertThat(both.at("/version").asInt()).isEqualTo(2);
    assertThat(count("outbox_event", "task.updated", task)).isEqualTo(1);
    assertThat(count("activity_event", "task.updated", task)).isEqualTo(1);

    // Writing the same values again is a no-op: no new version, no new event.
    Resp same =
        patchTask(
            f.ws().member(),
            task,
            2,
            Map.of("customFields", Map.of(a.toString(), 6, b.toString(), "bye")));
    assertThat(same.status()).isEqualTo(200);
    assertThat(same.at("/version").asInt()).isEqualTo(2);
    assertThat(count("outbox_event", "task.updated", task)).isEqualTo(1);
  }

  @Test
  void aStaleVersionAnswers409AndLeavesTheValue() {
    Fix f = fixture();
    UUID a = field(f.ws().owner(), f.space(), "A", "NUMBER");
    UUID task = task(f.ws().member(), f.list(), "T");
    assertThat(setValue(f.ws().member(), task, a, 1).status()).isEqualTo(200);
    Resp stale =
        patchTask(f.ws().member(), task, 1, Map.of("customFields", Map.of(a.toString(), 2)));
    assertThat(stale.status()).isEqualTo(409);
    assertThat(stale.text("/code")).isEqualTo("task.version_conflict");
    assertThat(stored(task).get(a.toString()).asInt()).isEqualTo(1);
  }

  // ---------------------------------------------------------------- no corruption (CAP-5)

  @Test
  void definitionChangesNeverTouchATaskRow() {
    Fix f = fixture();
    UUID tier = field(f.ws().owner(), f.space(), "Customer tier", "DROPDOWN", "Free", "Pro");
    UUID labels = field(f.ws().owner(), f.space(), "Tags", "LABELS", "a", "b", "c");
    UUID points = field(f.ws().owner(), f.space(), "Points", "NUMBER");
    UUID task = task(f.ws().member(), f.list(), "T");
    Resp set =
        patchTask(
            f.ws().member(),
            task,
            1,
            Map.of(
                "customFields",
                Map.of(
                    tier.toString(),
                    "Pro",
                    labels.toString(),
                    List.of("a", "c"),
                    points.toString(),
                    5)));
    assertThat(set.status()).as(set.raw()).isEqualTo(200);
    String before = storedText(task);
    long version = currentVersion(f.ws().member(), task);
    String updatedAt =
        jdbc.queryForObject("SELECT updated_at::text FROM task WHERE id = ?", String.class, task);

    JsonNode tierField = get("/api/v1/fields/" + tier, f.ws().owner().token()).json();
    UUID free = UUID.fromString(tierField.at("/options/0/id").asText());
    UUID pro = UUID.fromString(tierField.at("/options/1/id").asText());
    // Rename the field and an Option, reorder: the value follows the id.
    Resp renamed =
        patch(
            "/api/v1/fields/" + tier,
            f.ws().owner().token(),
            Map.of(
                "name",
                "Tier",
                "options",
                List.of(
                    Map.of("id", pro, "name", "Professional"), Map.of("id", free, "name", "Free"))),
            "If-Match",
            "\"1\"");
    assertThat(renamed.status()).as(renamed.raw()).isEqualTo(200);
    assertThat(storedText(task)).isEqualTo(before);
    assertThat(read(f.ws().member(), task).at("/customFields/" + tier).asText())
        .isEqualTo(pro.toString());
    assertThat(
            get("/api/v1/locations/" + f.list() + "/fields", f.ws().member().token())
                .at("/fields/0/options/0/name")
                .asText())
        .isEqualTo("Professional");

    // Retire the used Option: the value stays stored, reads omit it.
    patch(
        "/api/v1/fields/" + tier,
        f.ws().owner().token(),
        Map.of("options", List.of(Map.of("id", free, "name", "Free"))),
        "If-Match",
        "\"2\"");
    assertThat(storedText(task)).isEqualTo(before);
    assertThat(read(f.ws().member(), task).at("/customFields/" + tier).isMissingNode()).isTrue();
    // A retired Label is filtered out of the array, the live one stays.
    UUID labelA =
        UUID.fromString(
            get("/api/v1/fields/" + labels, f.ws().owner().token()).at("/options/0/id").asText());
    UUID labelB =
        UUID.fromString(
            get("/api/v1/fields/" + labels, f.ws().owner().token()).at("/options/1/id").asText());
    UUID labelC =
        UUID.fromString(
            get("/api/v1/fields/" + labels, f.ws().owner().token()).at("/options/2/id").asText());
    patch(
        "/api/v1/fields/" + labels,
        f.ws().owner().token(),
        Map.of(
            "options",
            List.of(Map.of("id", labelB, "name", "b"), Map.of("id", labelC, "name", "c"))),
        "If-Match",
        "\"1\"");
    JsonNode shown = read(f.ws().member(), task).at("/customFields/" + labels);
    assertThat(shown.size()).isEqualTo(1);
    assertThat(shown.get(0).asText()).isEqualTo(labelC.toString());
    assertThat(labelA).isNotEqualTo(labelC);

    // Retire the field: every value stays, reads omit it.
    assertThat(
            delete("/api/v1/fields/" + points, f.ws().owner().token(), "If-Match", "\"1\"")
                .status())
        .isEqualTo(204);
    assertThat(storedText(task)).isEqualTo(before);
    assertThat(read(f.ws().member(), task).at("/customFields/" + points).isMissingNode()).isTrue();

    assertThat(currentVersion(f.ws().member(), task)).isEqualTo(version);
    assertThat(
            jdbc.queryForObject(
                "SELECT updated_at::text FROM task WHERE id = ?", String.class, task))
        .isEqualTo(updatedAt);
  }

  @Test
  void hidingThenUnhidingRestoresTheValueAndAHiddenValueIsKept() {
    Fix f = fixture();
    UUID points = field(f.ws().owner(), f.space(), "Points", "NUMBER");
    UUID task = task(f.ws().member(), f.list(), "T");
    setValue(f.ws().member(), task, points, 8);
    String before = storedText(task);

    put(
        "/api/v1/locations/" + f.list() + "/fields/" + points + "/hidden",
        f.ws().member().token(),
        null);
    assertThat(read(f.ws().member(), task).at("/customFields/" + points).isMissingNode()).isTrue();
    assertThat(storedText(task)).isEqualTo(before);
    // Writing another field while the first is hidden keeps the hidden value (key-level merge).
    UUID note = field(f.ws().member(), f.list(), "Note", "TEXT");
    assertThat(setValue(f.ws().member(), task, note, "x").status()).isEqualTo(200);
    assertThat(stored(task).get(points.toString()).asInt()).isEqualTo(8);

    delete(
        "/api/v1/locations/" + f.list() + "/fields/" + points + "/hidden", f.ws().member().token());
    assertThat(read(f.ws().member(), task).at("/customFields/" + points).asInt()).isEqualTo(8);
  }

  @Test
  void movingKeepsCustomAndLeavesLeftBehindValuesUnshownUntilTheyReturn() {
    Fix f = fixture();
    UUID other = space(f.ws().owner(), f.ws().id(), "Other");
    UUID points = field(f.ws().owner(), f.space(), "Points", "NUMBER");
    UUID task = task(f.ws().member(), f.list(), "T");
    setValue(f.ws().member(), task, points, 8);
    String before = storedText(task);

    assertThat(
            post(
                    "/api/v1/locations/" + f.list() + "/move",
                    f.ws().owner().token(),
                    Map.of("parentId", other))
                .status())
        .isEqualTo(200);
    assertThat(storedText(task)).isEqualTo(before);
    assertThat(read(f.ws().member(), task).at("/customFields").size()).isZero();
    post(
        "/api/v1/locations/" + f.list() + "/move",
        f.ws().owner().token(),
        Map.of("parentId", f.space()));
    assertThat(read(f.ws().member(), task).at("/customFields/" + points).asInt()).isEqualTo(8);

    // Moving the task to a List outside the field's branch behaves the same.
    UUID elsewhere = list(f.ws().member(), other, "E");
    long version = currentVersion(f.ws().member(), task);
    Resp moved = move(f.ws().member(), task, version, Map.of("listId", elsewhere));
    assertThat(moved.status()).as(moved.raw()).isEqualTo(200);
    assertThat(storedText(task)).isEqualTo(before);
    assertThat(read(f.ws().member(), task).at("/customFields").size()).isZero();
  }

  private Resp move(TestUser user, UUID task, long version, Map<String, Object> body) {
    return post(
        "/api/v1/tasks/" + task + "/move", user.token(), body, "If-Match", "\"" + version + "\"");
  }

  @Test
  void duplicateCopiesTheValues() {
    Fix f = fixture();
    UUID points = field(f.ws().owner(), f.space(), "Points", "NUMBER");
    UUID task = task(f.ws().member(), f.list(), "T");
    setValue(f.ws().member(), task, points, 8);
    Resp copy = post("/api/v1/tasks/" + task + "/duplicate", f.ws().member().token(), Map.of());
    assertThat(copy.status()).as(copy.raw()).isIn(200, 201);
    assertThat(copy.at("/customFields/" + points).asInt()).isEqualTo(8);
  }

  // ---------------------------------------------------------------- events

  @Test
  void theActivitySnapshotIsCutAndLongTextKeepsNoRawValue() {
    Fix f = fixture();
    UUID longText = field(f.ws().owner(), f.space(), "Notes", "LONG_TEXT");
    UUID text = field(f.ws().owner(), f.space(), "Title", "TEXT");
    UUID tier = field(f.ws().owner(), f.space(), "Tier", "DROPDOWN", "Free");
    UUID task = task(f.ws().member(), f.list(), "T");
    String big = "y".repeat(5000);

    Resp r =
        patchTask(
            f.ws().member(),
            task,
            1,
            Map.of(
                "customFields",
                Map.of(
                    longText.toString(),
                    big,
                    text.toString(),
                    "z".repeat(300),
                    tier.toString(),
                    "Free")));
    assertThat(r.status()).as(r.raw()).isEqualTo(200);
    JsonNode payload =
        jsonOf(
            jdbc.queryForObject(
                "SELECT payload::text FROM outbox_event WHERE entity_id = ? AND type = 'task.updated'",
                String.class,
                task));
    JsonNode changes = payload.at("/changes/customFields");
    JsonNode longEntry = changes.get(longText.toString());
    assertThat(longEntry.has("from")).isFalse();
    assertThat(longEntry.has("to")).isFalse();
    assertThat(longEntry.get("toText").asText().length()).isLessThanOrEqualTo(200);
    assertThat(longEntry.get("field").asText()).isEqualTo("Notes");
    JsonNode textEntry = changes.get(text.toString());
    assertThat(textEntry.get("toText").asText().length()).isLessThanOrEqualTo(200);
    assertThat(textEntry.get("to").asText()).hasSize(300);
    assertThat(changes.get(tier.toString()).get("toText").asText()).isEqualTo("Free");
    assertThat(changes.get(tier.toString()).get("fromText").asText()).isEmpty();
    assertThat(
            jdbc.queryForObject(
                "SELECT length(payload::text) FROM outbox_event WHERE entity_id = ? AND type = 'task.updated'",
                Integer.class,
                task))
        .isLessThan(3000);
    assertThat(count("outbox_event", "task.updated", task)).isEqualTo(1);
    assertThat(count("activity_event", "task.updated", task)).isEqualTo(1);
  }

  private JsonNode jsonOf(String raw) {
    try {
      return mapper.readTree(raw);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  // ---------------------------------------------------------------- permissions

  @Test
  void aGuestOrReadOnlyCallerCannotWriteValuesAndAKeyThatCannotSeeTheListIsRefused() {
    Fix f = fixture();
    UUID points = field(f.ws().owner(), f.space(), "Points", "NUMBER");
    UUID task = task(f.ws().member(), f.list(), "T");
    put(
        "/api/v1/locations/" + f.space() + "/grants/" + f.ws().guest().id(),
        f.ws().owner().token(),
        null);

    Resp guest =
        patchTask(f.ws().guest(), task, 1, Map.of("customFields", Map.of(points.toString(), 1)));
    assertThat(guest.status()).isEqualTo(403);
    assertThat(storedText(task)).isEqualTo("{}");

    // An outsider (not a member) cannot even see the task.
    TestUser outsider = signUp("Outsider");
    assertThat(
            patchTask(outsider, task, 1, Map.of("customFields", Map.of(points.toString(), 1)))
                .status())
        .isEqualTo(404);
    // A key of another workspace's service account cannot see the List either.
    Ws other = workspaceWithAllRoles();
    Agent foreign = agent(other.owner(), other.id());
    Resp byKey =
        patch(
            "/api/v1/tasks/" + task,
            foreign.secret(),
            Map.of("customFields", Map.of(points.toString(), 1)),
            "If-Match",
            "\"1\"");
    assertThat(byKey.status()).isEqualTo(404);
    assertThat(storedText(task)).isEqualTo("{}");

    // A key in the workspace works and is attributed to the account and key.
    Agent agent = agent(f.ws().owner(), f.ws().id(), "bot", "ci");
    Resp ok =
        patch(
            "/api/v1/tasks/" + task,
            agent.secret(),
            Map.of("customFields", Map.of(points.toString(), 3)),
            "If-Match",
            "\"1\"");
    assertThat(ok.status()).as(ok.raw()).isEqualTo(200);
    Map<String, Object> row =
        jdbc.queryForMap(
            "SELECT actor_type, actor_id, actor_key_id FROM activity_event WHERE entity_id = ? AND"
                + " type = 'task.updated'",
            task);
    assertThat(row.get("actor_type")).isEqualTo("SERVICE_ACCOUNT");
    assertThat(row.get("actor_key_id")).isEqualTo(agent.keyId());
  }
}
