package com.taskflow.field.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.identity.internal.ServiceAccountTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("FIELD-1/2 custom field definitions and inheritance")
class CustomFieldIT extends ServiceAccountTestBase {

  private Resp fields(TestUser user, UUID location) {
    return get("/api/v1/locations/" + location + "/fields", user.token());
  }

  private Resp create(TestUser user, UUID location, String name, String type) {
    return post(
        "/api/v1/locations/" + location + "/fields",
        user.token(),
        Map.of("name", name, "type", type));
  }

  private UUID created(TestUser user, UUID location, String name, String type) {
    Resp r = create(user, location, name, type);
    assertThat(r.status()).as(r.raw()).isEqualTo(201);
    return r.uuid("/id");
  }

  private List<String> names(Resp r) {
    List<String> out = new ArrayList<>();
    r.at("/fields").forEach(f -> out.add(f.get("name").asText()));
    return out;
  }

  private JsonNode byName(Resp r, String name) {
    for (JsonNode f : r.at("/fields")) {
      if (f.get("name").asText().equals(name)) {
        return f;
      }
    }
    throw new IllegalArgumentException(name);
  }

  private Resp patchField(TestUser user, UUID field, long version, Map<String, Object> body) {
    return patch("/api/v1/fields/" + field, user.token(), body, "If-Match", "\"" + version + "\"");
  }

  private int events(UUID entityId, String type) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM outbox_event WHERE entity_id = ? AND type = ?",
        Integer.class,
        entityId,
        type);
  }

  private int activity(UUID entityId, String type) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM activity_event WHERE entity_id = ? AND type = ?",
        Integer.class,
        entityId,
        type);
  }

  @Test
  void effectiveSetIsSpaceThenFolderThenListWithDefinedAtAndHides() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Eng");
    UUID folder = folder(ws.member(), space, "Platform");
    UUID list = list(ws.member(), folder, "Backlog");
    created(ws.owner(), space, "Story points", "NUMBER");
    created(ws.member(), folder, "Owner team", "TEXT");
    created(ws.member(), list, "Due note", "LONG_TEXT");
    created(ws.owner(), space, "Customer tier", "DROPDOWN");

    Resp r = fields(ws.member(), list);
    assertThat(r.status()).isEqualTo(200);
    assertThat(names(r)).containsExactly("Story points", "Customer tier", "Owner team", "Due note");
    assertThat(byName(r, "Story points").get("definedAt").asText()).isEqualTo(space.toString());
    assertThat(byName(r, "Story points").get("definedAtName").asText()).isEqualTo("Eng");
    assertThat(byName(r, "Story points").get("inherited").asBoolean()).isTrue();
    assertThat(byName(r, "Owner team").get("definedAt").asText()).isEqualTo(folder.toString());
    assertThat(byName(r, "Due note").get("inherited").asBoolean()).isFalse();
    assertThat(r.at("/canEdit").asBoolean()).isTrue();

    // A Space sees only its own; a sibling List below another Space sees none of them.
    assertThat(names(fields(ws.owner(), space))).containsExactly("Story points", "Customer tier");
    UUID other = list(ws.member(), space(ws.owner(), ws.id(), "Ops"), "L");
    assertThat(names(fields(ws.member(), other))).isEmpty();
  }

  @Test
  void hideAndUnhideAnInheritedFieldAndNeverAnOwnOne() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID folder = folder(ws.member(), space, "F");
    UUID list = list(ws.member(), folder, "L");
    UUID sibling = list(ws.member(), space, "Sibling");
    UUID points = created(ws.owner(), space, "Story points", "NUMBER");
    UUID own = created(ws.member(), list, "Own", "TEXT");

    Resp hidden =
        put(
            "/api/v1/locations/" + folder + "/fields/" + points + "/hidden",
            ws.member().token(),
            null);
    assertThat(hidden.status()).as(hidden.raw()).isEqualTo(200);
    assertThat(byName(hidden, "Story points").get("hidden").asBoolean()).isTrue();
    // Below the hide the field is gone; a sibling List elsewhere under the Space still has it.
    assertThat(names(fields(ws.member(), list))).containsExactly("Own");
    assertThat(names(fields(ws.member(), sibling))).containsExactly("Story points");
    assertThat(events(folder, "custom_field.hidden")).isEqualTo(1);

    // Hiding twice changes nothing and records nothing more.
    put("/api/v1/locations/" + folder + "/fields/" + points + "/hidden", ws.member().token(), null);
    assertThat(events(folder, "custom_field.hidden")).isEqualTo(1);

    Resp unhidden =
        delete(
            "/api/v1/locations/" + folder + "/fields/" + points + "/hidden", ws.member().token());
    assertThat(unhidden.status()).isEqualTo(200);
    assertThat(byName(unhidden, "Story points").get("hidden").asBoolean()).isFalse();
    assertThat(names(fields(ws.member(), list))).containsExactly("Story points", "Own");
    assertThat(events(folder, "custom_field.unhidden")).isEqualTo(1);

    Resp own400 =
        put("/api/v1/locations/" + list + "/fields/" + own + "/hidden", ws.member().token(), null);
    assertThat(own400.status()).isEqualTo(400);
    assertThat(own400.text("/code")).isEqualTo("field.hide_own");
  }

  @Test
  void aTypeCanNeverChangeAndAFieldRenames() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    Resp made = create(ws.member(), list, "Points", "NUMBER");
    UUID id = made.uuid("/id");
    assertThat(made.headers().getFirst("ETag")).isEqualTo("\"1\"");
    assertThat(made.at("/config/decimals").asInt()).isZero();

    Resp type = patchField(ws.member(), id, 1, Map.of("type", "TEXT"));
    assertThat(type.status()).isEqualTo(400);
    assertThat(type.text("/code")).isEqualTo("field.type_immutable");

    Resp renamed =
        patchField(ws.member(), id, 1, Map.of("name", "Effort", "config", Map.of("decimals", 2)));
    assertThat(renamed.status()).as(renamed.raw()).isEqualTo(200);
    assertThat(renamed.text("/name")).isEqualTo("Effort");
    assertThat(renamed.at("/version").asLong()).isEqualTo(2);
    assertThat(events(list, "custom_field.updated")).isEqualTo(1);

    assertThat(patchField(ws.member(), id, 2, Map.of("config", Map.of("max", 3))).text("/code"))
        .isEqualTo("field.invalid_config");
    assertThat(create(ws.member(), list, "Reviewer", "PEOPLE").status()).isEqualTo(201);
    assertThat(create(ws.member(), list, "P", "NOPE").text("/code"))
        .isEqualTo("field.invalid_type");
    assertThat(create(ws.member(), list, "  ", "TEXT").status()).isEqualTo(400);
  }

  @Test
  void aNameIsUniquePerBranchIgnoringCase() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID folder = folder(ws.member(), space, "F");
    UUID withLists = folder(ws.member(), space, "G");
    UUID list = list(ws.member(), withLists, "L");
    UUID emptyFolder = folder(ws.member(), space, "Empty");
    created(ws.member(), folder, "Tier", "TEXT");

    // The Space's name is taken below it (a descendant Folder defines it), with or without Lists.
    Resp up = create(ws.owner(), space, "tier", "TEXT");
    assertThat(up.status()).isEqualTo(409);
    assertThat(up.text("/code")).isEqualTo("field.name_taken");
    // Down: a List under the Folder that defines it, and a Folder-level clash with the Space's
    // field.
    created(ws.owner(), space, "Points", "NUMBER");
    assertThat(create(ws.member(), list, "POINTS", "NUMBER").text("/code"))
        .isEqualTo("field.name_taken");
    assertThat(create(ws.member(), emptyFolder, " Points ", "TEXT").status()).isEqualTo(409);
    // A sibling Folder branch may use a name another Folder uses.
    assertThat(create(ws.member(), list, "Tier", "TEXT").status()).isEqualTo(201);

    // Retiring frees the name.
    UUID rename = created(ws.member(), emptyFolder, "Temp", "TEXT");
    assertThat(
            delete("/api/v1/fields/" + rename, ws.member().token(), "If-Match", "\"1\"").status())
        .isEqualTo(204);
    assertThat(create(ws.member(), emptyFolder, "Temp", "NUMBER").status()).isEqualTo(201);
  }

  @Test
  void aLocationDefinesAtMostFiftyFields() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    for (int i = 0; i < 50; i++) {
      assertThat(create(ws.member(), list, "F" + i, "TEXT").status()).isEqualTo(201);
    }
    Resp over = create(ws.member(), list, "One more", "TEXT");
    assertThat(over.status()).isEqualTo(400);
    assertThat(over.text("/code")).isEqualTo("field.limit");
  }

  @Test
  void aStaleVersionAnswers409WithTheCurrentField() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    UUID id = created(ws.member(), list, "Points", "NUMBER");
    assertThat(patchField(ws.member(), id, 1, Map.of("name", "A")).status()).isEqualTo(200);
    Resp stale = patchField(ws.member(), id, 1, Map.of("name", "B"));
    assertThat(stale.status()).isEqualTo(409);
    assertThat(stale.text("/code")).isEqualTo("field.stale");
    assertThat(stale.text("/current/name")).isEqualTo("A");
    Resp staleDelete = delete("/api/v1/fields/" + id, ws.member().token(), "If-Match", "\"1\"");
    assertThat(staleDelete.status()).isEqualTo(409);
    assertThat(delete("/api/v1/fields/" + id, ws.member().token()).status()).isEqualTo(428);
  }

  @Test
  void permissionsFollowLocationEdit() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    UUID onSpace = created(ws.admin(), space, "Points", "NUMBER");
    put("/api/v1/locations/" + space + "/grants/" + ws.guest().id(), ws.owner().token(), null);

    assertThat(create(ws.guest(), list, "G", "TEXT").status()).isEqualTo(403);
    assertThat(create(ws.member(), space, "M", "TEXT").status()).isEqualTo(403);
    assertThat(fields(ws.guest(), list).at("/canEdit").asBoolean()).isFalse();
    assertThat(fields(ws.guest(), list).status()).isEqualTo(200);
    assertThat(fields(ws.member(), space).at("/canEdit").asBoolean()).isFalse();
    // A member can neither change nor retire a Space-level field, nor hide it as a guest.
    assertThat(patchField(ws.member(), onSpace, 1, Map.of("name", "X")).status()).isEqualTo(403);
    assertThat(
            delete("/api/v1/fields/" + onSpace, ws.member().token(), "If-Match", "\"1\"").status())
        .isEqualTo(403);
    assertThat(
            put(
                    "/api/v1/locations/" + list + "/fields/" + onSpace + "/hidden",
                    ws.guest().token(),
                    null)
                .status())
        .isEqualTo(403);
    // An outsider cannot even see it.
    TestUser outsider = signUp("Outsider");
    assertThat(fields(outsider, list).status()).isEqualTo(404);
    assertThat(get("/api/v1/fields/" + onSpace, outsider.token()).status()).isEqualTo(404);
  }

  @Test
  void optionNamesAreUniqueAmongLiveOptionsAndRenamesKeepIds() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    Resp dup =
        post(
            "/api/v1/locations/" + list + "/fields",
            ws.member().token(),
            Map.of(
                "name",
                "Priority",
                "type",
                "DROPDOWN",
                "options",
                List.of(Map.of("name", "High"), Map.of("name", "high"))));
    assertThat(dup.status()).isEqualTo(400);
    assertThat(dup.text("/code")).isEqualTo("field.option_name_taken");

    Resp made =
        post(
            "/api/v1/locations/" + list + "/fields",
            ws.member().token(),
            Map.of(
                "name",
                "Tier",
                "type",
                "DROPDOWN",
                "options",
                List.of(Map.of("name", "Free"), Map.of("name", "Pro", "color", "blue"))));
    assertThat(made.status()).as(made.raw()).isEqualTo(201);
    UUID id = made.uuid("/id");
    UUID free = UUID.fromString(made.at("/options/0/id").asText());
    UUID pro = UUID.fromString(made.at("/options/1/id").asText());
    assertThat(made.text("/options/1/color")).isEqualTo("blue");

    // Rename Free, drop Pro, add Enterprise, in a new order.
    Resp edited =
        patchField(
            ws.member(),
            id,
            1,
            Map.of(
                "options",
                List.of(Map.of("name", "Enterprise"), Map.of("id", free, "name", "Starter"))));
    assertThat(edited.status()).as(edited.raw()).isEqualTo(200);
    assertThat(edited.text("/options/0/name")).isEqualTo("Enterprise");
    assertThat(edited.text("/options/1/id")).isEqualTo(free.toString());
    assertThat(edited.text("/options/1/name")).isEqualTo("Starter");
    // Retired rows stay; a retired option's name is free again.
    assertThat(
            jdbc.queryForObject(
                "SELECT retired_at IS NOT NULL FROM custom_field_option WHERE id = ?",
                Boolean.class,
                pro))
        .isTrue();
    Resp reuse =
        patchField(
            ws.member(),
            id,
            2,
            Map.of(
                "options", List.of(Map.of("id", free, "name", "Starter"), Map.of("name", "Pro"))));
    assertThat(reuse.status()).as(reuse.raw()).isEqualTo(200);
    Resp unknown =
        patchField(
            ws.member(), id, 3, Map.of("options", List.of(Map.of("id", pro, "name", "Pro"))));
    assertThat(unknown.status()).isEqualTo(400);
    assertThat(unknown.text("/code")).isEqualTo("field.unknown_option");
    assertThat(
            patchField(
                    ws.member(),
                    id,
                    3,
                    Map.of("options", List.of(Map.of("name", "A", "color", "plaid"))))
                .status())
        .isEqualTo(400);
  }

  @Test
  void retiringKeepsTheRowAndNothingDeletesDefinitions() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    UUID a = created(ws.member(), list, "A", "TEXT");
    UUID b = created(ws.member(), list, "B", "TEXT");
    // Reorder: B before A.
    Resp moved = patchField(ws.member(), b, 1, Map.of("beforeId", a));
    assertThat(moved.status()).as(moved.raw()).isEqualTo(200);
    assertThat(names(fields(ws.member(), list))).containsExactly("B", "A");

    assertThat(delete("/api/v1/fields/" + a, ws.member().token(), "If-Match", "\"1\"").status())
        .isEqualTo(204);
    assertThat(names(fields(ws.member(), list))).containsExactly("B");
    assertThat(
            jdbc.queryForObject(
                "SELECT retired_at IS NOT NULL FROM custom_field WHERE id = ?", Boolean.class, a))
        .isTrue();
    assertThat(jdbc.queryForObject("SELECT version FROM custom_field WHERE id = ?", Long.class, a))
        .isEqualTo(2);
    assertThat(events(list, "custom_field.retired")).isEqualTo(1);
    // A retired field is gone for further writes.
    assertThat(patchField(ws.member(), a, 2, Map.of("name", "Z")).status()).isEqualTo(404);
  }

  @Test
  void eachChangeWritesOneActivityAndOneOutboxRowForUsersAndKeys() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    UUID folder = folder(ws.member(), space, "F");

    UUID byUser = created(ws.member(), list, "ByUser", "TEXT");
    assertThat(events(list, "custom_field.created")).isEqualTo(1);
    assertThat(activity(list, "custom_field.created")).isEqualTo(1);
    Map<String, Object> row =
        jdbc.queryForMap(
            "SELECT actor_type, actor_id, actor_key_id, payload::text AS payload FROM activity_event"
                + " WHERE entity_id = ? AND type = 'custom_field.created'",
            list);
    assertThat(row.get("actor_type")).isEqualTo("USER");
    assertThat(row.get("actor_id")).isEqualTo(ws.member().id());
    assertThat(row.get("actor_key_id")).isNull();
    assertThat((String) row.get("payload")).contains(byUser.toString()).contains("\"path\"");

    Agent agent = agent(ws.owner(), ws.id(), "bot", "ci");
    Resp r =
        post(
            "/api/v1/locations/" + folder + "/fields",
            agent.secret(),
            Map.of("name", "ByAgent", "type", "CHECKBOX"));
    assertThat(r.status()).as(r.raw()).isEqualTo(201);
    Map<String, Object> agentRow =
        jdbc.queryForMap(
            "SELECT actor_type, actor_id, actor_key_id FROM activity_event WHERE entity_id = ? AND"
                + " type = 'custom_field.created'",
            folder);
    assertThat(agentRow.get("actor_type")).isEqualTo("SERVICE_ACCOUNT");
    assertThat(agentRow.get("actor_id")).isEqualTo(agent.id());
    assertThat(agentRow.get("actor_key_id")).isEqualTo(agent.keyId());
    assertThat(events(folder, "custom_field.created")).isEqualTo(1);
    assertThat(activity(folder, "custom_field.created")).isEqualTo(1);
  }

  @Test
  void anIdempotentRetryCreatesOneField() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    String key = UUID.randomUUID().toString();
    Map<String, Object> body = Map.of("name", "Once", "type", "TEXT");
    Resp first =
        post(
            "/api/v1/locations/" + list + "/fields",
            ws.member().token(),
            body,
            "Idempotency-Key",
            key);
    Resp retry =
        post(
            "/api/v1/locations/" + list + "/fields",
            ws.member().token(),
            body,
            "Idempotency-Key",
            key);
    assertThat(first.status()).isEqualTo(201);
    assertThat(retry.status()).isEqualTo(201);
    assertThat(retry.text("/id")).isEqualTo(first.text("/id"));
    assertThat(names(fields(ws.member(), list))).containsExactly("Once");
    assertThat(events(list, "custom_field.created")).isEqualTo(1);
  }

  @Test
  void twoConcurrentCreatesOfOneNameLeaveOne() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    CountDownLatch go = new CountDownLatch(1);
    CompletableFuture<Resp> atSpace =
        CompletableFuture.supplyAsync(() -> {
          await(go);
          return create(ws.owner(), space, "Racy", "TEXT");
        });
    CompletableFuture<Resp> atList =
        CompletableFuture.supplyAsync(() -> {
          await(go);
          return create(ws.member(), list, "racy", "TEXT");
        });
    go.countDown();
    List<Integer> statuses = List.of(atSpace.get().status(), atList.get().status());
    assertThat(statuses).containsExactlyInAnyOrder(201, 409);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM custom_field WHERE workspace_id = ? AND lower(name) = 'racy'",
                Integer.class,
                ws.id()))
        .isEqualTo(1);
  }

  @Test
  void aMoveThatWouldDuplicateAFieldNameIsRefusedAndChangesNothing() {
    Ws ws = workspaceWithAllRoles();
    UUID from = space(ws.owner(), ws.id(), "From");
    UUID to = space(ws.owner(), ws.id(), "To");
    UUID list = list(ws.member(), from, "L");
    created(ws.member(), list, "Tier", "TEXT");
    created(ws.owner(), to, "tier", "TEXT");
    String pathBefore =
        jdbc.queryForObject("SELECT path::text FROM location WHERE id = ?", String.class, list);

    Resp move =
        post("/api/v1/locations/" + list + "/move", ws.owner().token(), Map.of("parentId", to));
    assertThat(move.status()).as(move.raw()).isEqualTo(409);
    assertThat(move.text("/code")).isEqualTo("field.name_taken");
    assertThat(
            jdbc.queryForObject("SELECT path::text FROM location WHERE id = ?", String.class, list))
        .isEqualTo(pathBefore);
    assertThat(jdbc.queryForObject("SELECT parent_id FROM location WHERE id = ?", UUID.class, list))
        .isEqualTo(from);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE entity_id = ? AND type = 'location.moved'",
                Integer.class,
                list))
        .isZero();
  }

  @Test
  void movingAListAwayFromItsFieldsLeavesTheStoredValuesByteIdentical() {
    Ws ws = workspaceWithAllRoles();
    UUID from = space(ws.owner(), ws.id(), "From");
    UUID to = space(ws.owner(), ws.id(), "To");
    UUID list = list(ws.member(), from, "L");
    UUID points = created(ws.owner(), from, "Story points", "NUMBER");
    UUID task = task(ws.member(), list, "T");
    jdbc.update(
        "UPDATE task SET custom = CAST(? AS jsonb) WHERE id = ?",
        "{\"" + points + "\": 5, \"" + UUID.randomUUID() + "\": \"orphan\"}",
        task);
    String before =
        jdbc.queryForObject("SELECT custom::text FROM task WHERE id = ?", String.class, task);

    assertThat(
            post("/api/v1/locations/" + list + "/move", ws.owner().token(), Map.of("parentId", to))
                .status())
        .isEqualTo(200);
    assertThat(names(fields(ws.member(), list))).isEmpty();
    assertThat(
            jdbc.queryForObject("SELECT custom::text FROM task WHERE id = ?", String.class, task))
        .isEqualTo(before);
    assertThat(
            post(
                    "/api/v1/locations/" + list + "/move",
                    ws.owner().token(),
                    Map.of("parentId", from))
                .status())
        .isEqualTo(200);
    assertThat(names(fields(ws.member(), list))).containsExactly("Story points");
    assertThat(
            jdbc.queryForObject("SELECT custom::text FROM task WHERE id = ?", String.class, task))
        .isEqualTo(before);
  }

  /** Risk review: a move and a field write at the move's target must never deadlock into a 500. */
  @Test
  void aMoveRacingAFieldCreateAtTheTargetNeverAnswers500() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID target = space(ws.owner(), ws.id(), "Target");
    UUID source = space(ws.owner(), ws.id(), "Source");
    for (int round = 0; round < 6; round++) {
      UUID list = list(ws.member(), source, "L" + round);
      String name = "Racing" + round;
      CountDownLatch go = new CountDownLatch(1);
      CompletableFuture<Resp> move =
          CompletableFuture.supplyAsync(() -> {
            await(go);
            return post(
                "/api/v1/locations/" + list + "/move",
                ws.owner().token(),
                Map.of("parentId", target));
          });
      CompletableFuture<Resp> field =
          CompletableFuture.supplyAsync(() -> {
            await(go);
            return create(ws.owner(), target, name, "TEXT");
          });
      go.countDown();
      assertThat(move.get().status()).isIn(200, 409);
      assertThat(field.get().status()).isEqualTo(201);
    }
  }

  private static void await(CountDownLatch latch) {
    try {
      latch.await();
    } catch (InterruptedException e) {
      throw new IllegalStateException(e);
    }
  }
}
