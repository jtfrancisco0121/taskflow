package com.taskflow.automation.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("AUTO-1 rules at a Location")
class AutomationRuleIT extends IntegrationTest {

  static Map<String, Object> rule(String name, String statusName) {
    return Map.of(
        "name",
        name,
        "trigger",
        Map.of("type", "STATUS_CHANGED", "toStatuses", List.of(statusName)),
        "conditions",
        List.of(),
        "actions",
        List.of(Map.of("type", "ADD_COMMENT", "text", "Moved on")));
  }

  @Test
  void createEditDisableAndDeleteFollowTheContract() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Eng");

    Resp created =
        post(
            "/api/v1/locations/" + space + "/automations",
            ws.admin().token(),
            rule("Done notes", "complete"));
    assertThat(created.status()).isEqualTo(201);
    assertThat(created.headers().getETag()).isEqualTo("\"1\"");
    assertThat(created.at("/enabled").asBoolean()).isTrue();
    assertThat(created.text("/createdBy/id")).isEqualTo(ws.admin().id().toString());
    UUID id = created.uuid("/id");

    Resp stale =
        patch(
            "/api/v1/automations/" + id,
            ws.admin().token(),
            Map.of("enabled", false),
            "If-Match",
            "\"7\"");
    assertThat(stale.status()).isEqualTo(409);
    assertThat(stale.text("/code")).isEqualTo("automation.stale");
    assertThat(stale.at("/current/id").asText()).isEqualTo(id.toString());

    Resp missing = patch("/api/v1/automations/" + id, ws.admin().token(), Map.of("enabled", false));
    assertThat(missing.status()).isEqualTo(428);

    Resp off =
        patch(
            "/api/v1/automations/" + id,
            ws.admin().token(),
            Map.of("enabled", false),
            "If-Match",
            "\"1\"");
    assertThat(off.status()).isEqualTo(200);
    assertThat(off.at("/enabled").asBoolean()).isFalse();
    assertThat(off.headers().getETag()).isEqualTo("\"2\"");

    Resp renamed =
        patch(
            "/api/v1/automations/" + id,
            ws.admin().token(),
            Map.of("name", "Done notes v2"),
            "If-Match",
            "\"2\"");
    assertThat(renamed.text("/name")).isEqualTo("Done notes v2");

    assertThat(delete("/api/v1/automations/" + id, ws.admin().token()).status()).isEqualTo(204);
    assertThat(get("/api/v1/automations/" + id, ws.admin().token()).status()).isEqualTo(404);

    // every write is an activity event attributed to the person
    List<String> types =
        jdbc.queryForList(
            "SELECT type FROM activity_event WHERE entity = 'automation' AND entity_id = ? AND"
                + " actor_id = ? ORDER BY created_at, id",
            String.class,
            id,
            ws.admin().id());
    assertThat(types)
        .containsExactly(
            "automation.created",
            "automation.disabled",
            "automation.updated",
            "automation.deleted");
  }

  @Test
  void aViewOnlyMemberCannotWriteAndAnOutsiderSeesNothing() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Eng");
    UUID list = list(ws.owner(), space, "Backlog");
    Resp created =
        post(
            "/api/v1/locations/" + list + "/automations",
            ws.member().token(),
            rule("R", "complete"));
    assertThat(created.status()).isEqualTo(201);
    UUID id = created.uuid("/id");

    // a guest holds no grant: the location is invisible, so 404
    assertThat(
            post(
                    "/api/v1/locations/" + list + "/automations",
                    ws.guest().token(),
                    rule("G", "complete"))
                .status())
        .isEqualTo(404);
    assertThat(get("/api/v1/automations/" + id, ws.guest().token()).status()).isEqualTo(404);

    // an admin-only Space: a MEMBER can read the rules there but not write
    Resp spaceRule =
        post(
            "/api/v1/locations/" + space + "/automations",
            ws.member().token(),
            rule("S", "complete"));
    assertThat(spaceRule.status()).isEqualTo(403);
    Resp listing = get("/api/v1/locations/" + space + "/automations", ws.member().token());
    assertThat(listing.status()).isEqualTo(200);
    assertThat(listing.at("/canEdit").asBoolean()).isFalse();

    TestUser stranger = signUp("Stranger");
    assertThat(get("/api/v1/locations/" + space + "/automations", stranger.token()).status())
        .isEqualTo(404);
  }

  @Test
  void limitsAndUnknownIdsAreRefusedWithCodes() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.owner(), space(ws.owner(), ws.id(), "Eng"), "Backlog");
    String path = "/api/v1/locations/" + list + "/automations";

    for (int i = 0; i < 50; i++) {
      assertThat(post(path, ws.owner().token(), rule("R" + i, "complete")).status()).isEqualTo(201);
    }
    Resp over = post(path, ws.owner().token(), rule("R51", "complete"));
    assertThat(over.status()).isEqualTo(400);
    assertThat(over.text("/code")).isEqualTo("automation.limit");

    UUID other = list(ws.owner(), space(ws.owner(), ws.id(), "Ops"), "L");
    String otherPath = "/api/v1/locations/" + other + "/automations";
    List<Map<String, Object>> eleven = new ArrayList<>();
    for (int i = 0; i < 11; i++) {
      eleven.add(Map.of("type", "TAG", "operator", "HAS", "tag", "t" + i));
    }
    Map<String, Object> tooManyConditions =
        Map.of(
            "name",
            "C",
            "trigger",
            Map.of("type", "TASK_CREATED"),
            "conditions",
            eleven,
            "actions",
            List.of(Map.of("type", "SET_PRIORITY", "priority", "HIGH")));
    assertThat(post(otherPath, ws.owner().token(), tooManyConditions).text("/code"))
        .isEqualTo("automation.invalid_condition");

    List<Map<String, Object>> actions = new ArrayList<>();
    for (int i = 0; i < 11; i++) {
      actions.add(Map.of("type", "SET_PRIORITY", "priority", "HIGH"));
    }
    Map<String, Object> tooManyActions =
        Map.of("name", "A", "trigger", Map.of("type", "TASK_CREATED"), "actions", actions);
    assertThat(post(otherPath, ws.owner().token(), tooManyActions).text("/code"))
        .isEqualTo("automation.invalid_action");

    Map<String, Object> unknownPerson =
        Map.of(
            "name", "P",
            "trigger", Map.of("type", "TASK_CREATED"),
            "actions", List.of(Map.of("type", "ASSIGN", "personIds", List.of(UUID.randomUUID()))));
    Resp bad = post(otherPath, ws.owner().token(), unknownPerson);
    assertThat(bad.status()).isEqualTo(400);
    assertThat(bad.text("/code")).isEqualTo("automation.invalid_action");

    Map<String, Object> unknownField =
        Map.of(
            "name", "F",
            "trigger", Map.of("type", "CUSTOM_FIELD_CHANGED", "fieldId", UUID.randomUUID()),
            "actions", List.of(Map.of("type", "SET_PRIORITY", "priority", "HIGH")));
    assertThat(post(otherPath, ws.owner().token(), unknownField).text("/code"))
        .isEqualTo("automation.invalid_trigger");

    Resp unknownStatus = post(otherPath, ws.owner().token(), rule("S", "Nonexistent"));
    assertThat(unknownStatus.text("/code")).isEqualTo("automation.invalid_trigger");
  }

  @Test
  void aLocationListsRulesInheritedFromItsAncestorsWithWhereTheyAreDefined() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Eng");
    UUID folder = folder(ws.owner(), space, "Q1");
    UUID list = list(ws.owner(), folder, "Backlog");
    UUID spaceRule =
        post(
                "/api/v1/locations/" + space + "/automations",
                ws.owner().token(),
                rule("Space rule", "complete"))
            .uuid("/id");
    post(
        "/api/v1/locations/" + list + "/automations",
        ws.owner().token(),
        rule("List rule", "complete"));
    UUID sibling = list(ws.owner(), space, "Other");
    post(
        "/api/v1/locations/" + sibling + "/automations",
        ws.owner().token(),
        rule("Sibling rule", "complete"));

    Resp listing = get("/api/v1/locations/" + list + "/automations", ws.member().token());
    assertThat(listing.status()).isEqualTo(200);
    assertThat(listing.at("/rules")).hasSize(2);
    assertThat(listing.text("/rules/0/id")).isEqualTo(spaceRule.toString());
    assertThat(listing.at("/rules/0/inherited").asBoolean()).isTrue();
    assertThat(listing.text("/rules/0/definedAtName")).isEqualTo("Eng");
    assertThat(listing.at("/rules/0/createdBy/name").asText()).isEqualTo("Owner");
    assertThat(listing.text("/rules/1/name")).isEqualTo("List rule");
    assertThat(listing.at("/rules/1/inherited").asBoolean()).isFalse();
  }
}
