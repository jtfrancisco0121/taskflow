package com.taskflow.field.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.IntegrationTest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("STAT status sets")
class StatusIT extends IntegrationTest {

  private Resp statuses(TestUser user, UUID location) {
    return get("/api/v1/locations/" + location + "/statuses", user.token());
  }

  private List<String> names(Resp r) {
    List<String> out = new ArrayList<>();
    r.at("/statuses").forEach(s -> out.add(s.get("name").asText()));
    return out;
  }

  private UUID idOf(Resp r, String name) {
    for (JsonNode s : r.at("/statuses")) {
      if (s.get("name").asText().equals(name)) {
        return UUID.fromString(s.get("id").asText());
      }
    }
    throw new IllegalArgumentException(name);
  }

  private static Map<String, Object> st(String name, String group) {
    return Map.of("name", name, "group", group);
  }

  private static Map<String, Object> keep(UUID id, String name, String group) {
    return Map.of("id", id, "name", name, "group", group);
  }

  @Test
  void aNewSpaceResolvesTheDefaultSet_STAT2() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    Resp r = statuses(ws.member(), space);
    assertThat(r.status()).isEqualTo(200);
    assertThat(names(r)).containsExactly("to do", "in progress", "complete", "closed");
    assertThat(r.text("/statuses/0/group")).isEqualTo("NOT_STARTED");
    assertThat(r.text("/statuses/2/group")).isEqualTo("DONE");
    assertThat(r.text("/statuses/3/group")).isEqualTo("CLOSED");
    assertThat(r.at("/inheritedFrom").isNull()).isTrue();

    UUID folder = folder(ws.member(), space, "F");
    UUID list = list(ws.member(), folder, "L");
    Resp inherited = statuses(ws.member(), list);
    assertThat(names(inherited)).containsExactly("to do", "in progress", "complete", "closed");
    assertThat(inherited.uuid("/inheritedFrom")).isEqualTo(space);
    assertThat(inherited.at("/statuses/0/id")).isEqualTo(r.at("/statuses/0/id"));
  }

  @Test
  void aSpaceChangeReachesInheritingListsAndLeavesOverridingListsUntouched_STAT1() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID inheriting = list(ws.member(), space, "Inheriting");
    UUID overriding = list(ws.member(), space, "Overriding");
    Resp before = statuses(ws.member(), overriding);
    UUID todo = idOf(before, "to do");

    // The overriding List defines its own set; every inherited status is remapped by name.
    Resp override =
        put(
            "/api/v1/locations/" + overriding + "/statuses",
            ws.member().token(),
            Map.of(
                "statuses", List.of(st("backlog", "NOT_STARTED"), st("shipped", "DONE")),
                "remap",
                    List.of(
                        Map.of("from", todo, "to", "backlog"),
                        Map.of("from", idOf(before, "in progress"), "to", "backlog"),
                        Map.of("from", idOf(before, "complete"), "to", "shipped"),
                        Map.of("from", idOf(before, "closed"), "to", "shipped"))));
    assertThat(override.status()).as(override.raw()).isEqualTo(200);
    assertThat(override.uuid("/definedAt")).isEqualTo(overriding);

    UUID inProgress = idOf(before, "in progress");
    UUID complete = idOf(before, "complete");
    UUID closed = idOf(before, "closed");
    Resp changed =
        put(
            "/api/v1/locations/" + space + "/statuses",
            ws.admin().token(),
            Map.of(
                "statuses",
                List.of(
                    keep(todo, "to do", "NOT_STARTED"),
                    keep(inProgress, "doing", "ACTIVE"),
                    st("review", "ACTIVE"),
                    keep(complete, "done", "DONE")),
                "remap",
                List.of(Map.of("from", closed, "to", "done"))));
    assertThat(changed.status()).as(changed.raw()).isEqualTo(200);
    assertThat(names(changed)).containsExactly("to do", "doing", "review", "done");
    assertThat(idOf(changed, "doing")).isEqualTo(inProgress);

    assertThat(names(statuses(ws.member(), inheriting)))
        .containsExactly("to do", "doing", "review", "done");
    assertThat(names(statuses(ws.member(), overriding))).containsExactly("backlog", "shipped");
    assertThat(
            jdbc.queryForObject(
                "SELECT retired_at IS NOT NULL FROM status WHERE id = ?", Boolean.class, closed))
        .isTrue();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE entity_id = ? AND type = 'status_set.changed'",
                Integer.class,
                space))
        .isEqualTo(1);
  }

  @Test
  void aFolderOverrideAppliesToItsListsAndNotToTheirSiblings() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID folder = folder(ws.member(), space, "F");
    UUID inFolder = list(ws.member(), folder, "InFolder");
    UUID elsewhere = list(ws.member(), space, "Elsewhere");
    Resp spaceSet = statuses(ws.member(), space);

    Resp override =
        put(
            "/api/v1/locations/" + folder + "/statuses",
            ws.member().token(),
            Map.of(
                "statuses", List.of(st("open", "NOT_STARTED"), st("closed out", "CLOSED")),
                "remap",
                    List.of(
                        Map.of("from", idOf(spaceSet, "to do"), "to", "open"),
                        Map.of("from", idOf(spaceSet, "in progress"), "to", "open"),
                        Map.of("from", idOf(spaceSet, "complete"), "to", "closed out"),
                        Map.of("from", idOf(spaceSet, "closed"), "to", "closed out"))));
    assertThat(override.status()).as(override.raw()).isEqualTo(200);
    assertThat(names(statuses(ws.member(), inFolder))).containsExactly("open", "closed out");
    assertThat(statuses(ws.member(), inFolder).uuid("/inheritedFrom")).isEqualTo(folder);
    assertThat(names(statuses(ws.member(), elsewhere)))
        .containsExactly("to do", "in progress", "complete", "closed");
  }

  @Test
  void resetToInheritReturnsToTheParentsSet() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID folder = folder(ws.member(), space, "F");
    Resp spaceSet = statuses(ws.member(), space);
    put(
        "/api/v1/locations/" + folder + "/statuses",
        ws.member().token(),
        Map.of(
            "statuses", List.of(st("a", "NOT_STARTED"), st("b", "DONE")),
            "remap",
                List.of(
                    Map.of("from", idOf(spaceSet, "to do"), "to", "a"),
                    Map.of("from", idOf(spaceSet, "in progress"), "to", "a"),
                    Map.of("from", idOf(spaceSet, "complete"), "to", "b"),
                    Map.of("from", idOf(spaceSet, "closed"), "to", "b"))));
    Resp own = statuses(ws.member(), folder);
    assertThat(names(own)).containsExactly("a", "b");

    Resp withoutRemap =
        send(
            org.springframework.http.HttpMethod.DELETE,
            "/api/v1/locations/" + folder + "/statuses",
            ws.member().token(),
            Map.of());
    assertThat(withoutRemap.status()).isEqualTo(400);
    assertThat(withoutRemap.text("/code")).isEqualTo("status.remap_required");

    Resp reset =
        send(
            org.springframework.http.HttpMethod.DELETE,
            "/api/v1/locations/" + folder + "/statuses",
            ws.member().token(),
            Map.of(
                "remap",
                List.of(
                    Map.of("from", idOf(own, "a"), "to", "to do"),
                    Map.of("from", idOf(own, "b"), "to", "complete"))));
    assertThat(reset.status()).as(reset.raw()).isEqualTo(200);
    assertThat(names(reset)).containsExactly("to do", "in progress", "complete", "closed");
    assertThat(reset.uuid("/inheritedFrom")).isEqualTo(space);

    Resp again =
        send(
            org.springframework.http.HttpMethod.DELETE,
            "/api/v1/locations/" + folder + "/statuses",
            ws.member().token(),
            Map.of());
    assertThat(again.status()).isEqualTo(409);
    assertThat(again.text("/code")).isEqualTo("status.not_overridden");
    Resp onSpace =
        send(
            org.springframework.http.HttpMethod.DELETE,
            "/api/v1/locations/" + space + "/statuses",
            ws.owner().token(),
            Map.of());
    assertThat(onSpace.status()).isEqualTo(409);
  }

  @Test
  void aSetWithoutNotStartedOrWithoutDoneIsRefusedAndRemovalNeedsARemap() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    Resp current = statuses(ws.owner(), space);
    UUID todo = idOf(current, "to do");
    UUID inProgress = idOf(current, "in progress");
    UUID complete = idOf(current, "complete");
    UUID closed = idOf(current, "closed");
    String path = "/api/v1/locations/" + space + "/statuses";

    Resp noStart =
        put(
            path,
            ws.owner().token(),
            Map.of("statuses", List.of(st("doing", "ACTIVE"), st("done", "DONE"))));
    assertThat(noStart.status()).isEqualTo(400);
    Resp noEnd =
        put(
            path,
            ws.owner().token(),
            Map.of("statuses", List.of(keep(todo, "to do", "NOT_STARTED"), st("doing", "ACTIVE"))));
    assertThat(noEnd.status()).isEqualTo(400);

    Resp noRemap =
        put(
            path,
            ws.owner().token(),
            Map.of(
                "statuses",
                List.of(
                    keep(todo, "to do", "NOT_STARTED"),
                    keep(inProgress, "in progress", "ACTIVE"),
                    keep(complete, "complete", "DONE"))));
    assertThat(noRemap.status()).isEqualTo(400);
    assertThat(noRemap.text("/code")).isEqualTo("status.remap_required");
    assertThat(noRemap.text("/statusId")).isEqualTo(closed.toString());

    Resp badTarget =
        put(
            path,
            ws.owner().token(),
            Map.of(
                "statuses",
                    List.of(keep(todo, "to do", "NOT_STARTED"), keep(complete, "complete", "DONE")),
                "remap",
                    List.of(
                        Map.of("from", inProgress, "to", "nope"),
                        Map.of("from", closed, "to", "complete"))));
    assertThat(badTarget.status()).isEqualTo(400);
    assertThat(badTarget.text("/code")).isEqualTo("status.remap_target_unknown");

    Resp unknownId =
        put(
            path,
            ws.owner().token(),
            Map.of(
                "statuses", List.of(keep(UUID.randomUUID(), "x", "NOT_STARTED"), st("y", "DONE"))));
    assertThat(unknownId.status()).isEqualTo(400);
    assertThat(names(statuses(ws.owner(), space)))
        .containsExactly("to do", "in progress", "complete", "closed");
  }

  @Test
  void membersEditFolderAndListSetsButNotASpaceAndGuestsNothing() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    Resp spaceSet = statuses(ws.owner(), space);
    Map<String, Object> same =
        Map.of(
            "statuses",
            List.of(
                keep(idOf(spaceSet, "to do"), "to do", "NOT_STARTED"),
                keep(idOf(spaceSet, "in progress"), "in progress", "ACTIVE"),
                keep(idOf(spaceSet, "complete"), "complete", "DONE"),
                keep(idOf(spaceSet, "closed"), "closed", "CLOSED")));
    assertThat(put("/api/v1/locations/" + space + "/statuses", ws.member().token(), same).status())
        .isEqualTo(403);
    assertThat(put("/api/v1/locations/" + space + "/statuses", ws.guest().token(), same).status())
        .isEqualTo(404);
    Resp listSet =
        put(
            "/api/v1/locations/" + list + "/statuses",
            ws.member().token(),
            Map.of(
                "statuses",
                List.of(st("a", "NOT_STARTED"), st("b", "DONE")),
                "remap",
                List.of(
                    Map.of("from", idOf(spaceSet, "to do"), "to", "a"),
                    Map.of("from", idOf(spaceSet, "in progress"), "to", "a"),
                    Map.of("from", idOf(spaceSet, "complete"), "to", "b"),
                    Map.of("from", idOf(spaceSet, "closed"), "to", "b"))));
    assertThat(listSet.status()).as(listSet.raw()).isEqualTo(200);
    assertThat(put("/api/v1/locations/" + list + "/statuses", ws.guest().token(), same).status())
        .isEqualTo(404);
    assertThat(get("/api/v1/locations/" + list + "/statuses", ws.guest().token()).status())
        .isEqualTo(404);
  }
}
