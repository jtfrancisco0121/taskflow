package com.taskflow.workspace.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("LOC-1 locations: create, rename, reorder, move, archive, delete")
class LocationIT extends IntegrationTest {

  private String rank(UUID id) {
    return jdbc.queryForObject("SELECT rank FROM location WHERE id = ?", String.class, id);
  }

  private String path(UUID id) {
    return jdbc.queryForObject("SELECT path::text FROM location WHERE id = ?", String.class, id);
  }

  @Test
  void create_makesASpaceFolderAndListWithEventsAndPaths() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Engineering");
    UUID folder = folder(ws.member(), space, "Backend");
    UUID list = list(ws.member(), folder, "Sprint 1");

    Resp r = get("/api/v1/locations/" + list, ws.member().token());
    assertThat(r.status()).isEqualTo(200);
    assertThat(r.text("/type")).isEqualTo("LIST");
    assertThat(r.uuid("/parentId")).isEqualTo(folder);
    assertThat(path(list))
        .startsWith(path(space).replace("-", ""))
        .hasSizeGreaterThan(path(folder).length());
    assertThat(path(list)).isEqualTo(path(folder) + "." + list.toString().replace("-", ""));
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE workspace_id = ? AND type = 'location.created'",
                Integer.class,
                ws.id()))
        .isGreaterThanOrEqualTo(4);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM activity_event WHERE entity_id = ? AND type = 'location.created'",
                Integer.class,
                list))
        .isEqualTo(1);
  }

  @Test
  void rename_changesTheNameAndRecordsIt() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Old");
    Resp r = patch("/api/v1/locations/" + space, ws.admin().token(), Map.of("name", "New"));
    assertThat(r.status()).isEqualTo(200);
    assertThat(r.text("/name")).isEqualTo("New");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE entity_id = ? AND type = 'location.renamed'",
                Integer.class,
                space))
        .isEqualTo(1);
  }

  @Test
  void reorder_changesOnlyTheMovedRowsRank() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID a = list(ws.member(), space, "A");
    UUID b = list(ws.member(), space, "B");
    UUID c = list(ws.member(), space, "C");
    String rankA = rank(a);
    String rankB = rank(b);
    String rankC = rank(c);
    assertThat(treeIds(ws.member(), ws.id(), space, false)).containsExactly(a, b, c);

    Resp r = post("/api/v1/locations/" + c + "/move", ws.member().token(), Map.of("beforeId", a));
    assertThat(r.status()).isEqualTo(200);
    assertThat(treeIds(ws.member(), ws.id(), space, false)).containsExactly(c, a, b);
    assertThat(rank(a)).isEqualTo(rankA);
    assertThat(rank(b)).isEqualTo(rankB);
    assertThat(rank(c)).isNotEqualTo(rankC);

    post("/api/v1/locations/" + a + "/move", ws.member().token(), Map.of("afterId", b));
    assertThat(treeIds(ws.member(), ws.id(), space, false)).containsExactly(c, b, a);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE workspace_id = ? AND type = 'location.reordered'",
                Integer.class,
                ws.id()))
        .isEqualTo(2);
  }

  @Test
  void move_keepsTheSubtreeUnderTheNewParent() {
    Ws ws = workspaceWithAllRoles();
    UUID from = space(ws.owner(), ws.id(), "From");
    UUID to = space(ws.owner(), ws.id(), "To");
    UUID folder = folder(ws.member(), from, "F");
    UUID inner = list(ws.member(), folder, "Inner");

    Resp r =
        post("/api/v1/locations/" + folder + "/move", ws.member().token(), Map.of("parentId", to));
    assertThat(r.status()).as(r.raw()).isEqualTo(200);
    assertThat(r.uuid("/parentId")).isEqualTo(to);
    assertThat(path(folder)).isEqualTo(path(to) + "." + folder.toString().replace("-", ""));
    assertThat(path(inner)).isEqualTo(path(folder) + "." + inner.toString().replace("-", ""));
    assertThat(treeIds(ws.member(), ws.id(), to, false)).contains(folder);
    assertThat(treeIds(ws.member(), ws.id(), from, false)).doesNotContain(folder);
    assertThat(treeIds(ws.member(), ws.id(), folder, false)).contains(inner);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE entity_id = ? AND type = 'location.moved'",
                Integer.class,
                folder))
        .isEqualTo(1);
  }

  @Test
  void move_intoItsOwnSubtreeOrAnInvalidParentIsRefusedAndNothingChanges() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID folder = folder(ws.member(), space, "F");
    UUID inner = list(ws.member(), folder, "Inner");
    String pathBefore = path(inner);

    for (UUID target : List.of(folder, inner)) {
      Resp r =
          post(
              "/api/v1/locations/" + folder + "/move",
              ws.member().token(),
              Map.of("parentId", target));
      assertThat(r.status()).as("move folder under %s", target).isIn(400, 409);
    }
    Resp spaceMove =
        post(
            "/api/v1/locations/" + space + "/move", ws.owner().token(), Map.of("parentId", folder));
    assertThat(spaceMove.status()).isEqualTo(400);
    assertThat(path(inner)).isEqualTo(pathBefore);
    assertThat(
            jdbc.queryForObject("SELECT parent_id FROM location WHERE id = ?", UUID.class, folder))
        .isEqualTo(space);
  }

  @Test
  void archive_hidesFromTheTreeAndMakesTheSubtreeReadOnly() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID folder = folder(ws.member(), space, "F");
    UUID list = list(ws.member(), folder, "L");

    Resp archived = post("/api/v1/locations/" + folder + "/archive", ws.member().token(), null);
    assertThat(archived.status()).isEqualTo(200);
    assertThat(archived.at("/archived").asBoolean()).isTrue();
    assertThat(treeIds(ws.member(), ws.id(), space, false)).doesNotContain(folder);
    assertThat(treeIds(ws.member(), ws.id(), space, true)).contains(folder);

    Resp rename = patch("/api/v1/locations/" + list, ws.member().token(), Map.of("name", "x"));
    assertThat(rename.status()).isEqualTo(409);
    assertThat(rename.text("/code")).isEqualTo("location.archived");
    Resp create =
        post(
            "/api/v1/locations",
            ws.member().token(),
            Map.of("type", "LIST", "parentId", folder, "name", "n"));
    assertThat(create.status()).isEqualTo(409);
    assertThat(get("/api/v1/locations/" + list, ws.member().token()).status()).isEqualTo(200);

    assertThat(
            post("/api/v1/locations/" + folder + "/unarchive", ws.member().token(), null).status())
        .isEqualTo(200);
    assertThat(treeIds(ws.member(), ws.id(), space, false)).contains(folder);
    assertThat(
            patch("/api/v1/locations/" + list, ws.member().token(), Map.of("name", "x")).status())
        .isEqualTo(200);
  }

  @Test
  void delete_answers404ForTheLocationAndEverythingUnderIt() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID folder = folder(ws.member(), space, "F");
    UUID list = list(ws.member(), folder, "L");
    UUID sibling = list(ws.member(), space, "Sibling");

    assertThat(delete("/api/v1/locations/" + folder, ws.member().token()).status()).isEqualTo(204);
    assertThat(get("/api/v1/locations/" + folder, ws.owner().token()).status()).isEqualTo(404);
    assertThat(get("/api/v1/locations/" + list, ws.owner().token()).status()).isEqualTo(404);
    assertThat(get("/api/v1/locations/" + sibling, ws.owner().token()).status()).isEqualTo(200);
    assertThat(treeIds(ws.owner(), ws.id(), space, true)).containsExactly(sibling);
    assertThat(patch("/api/v1/locations/" + list, ws.owner().token(), Map.of("name", "x")).status())
        .isEqualTo(404);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE entity_id = ? AND type = 'location.deleted'",
                Integer.class,
                folder))
        .isEqualTo(1);
  }

  @Test
  void aSpaceCannotBeMovedButCanBeReordered() {
    Ws ws = workspaceWithAllRoles();
    UUID one = space(ws.owner(), ws.id(), "One");
    UUID two = space(ws.owner(), ws.id(), "Two");
    assertThat(treeIds(ws.owner(), ws.id(), null, false)).containsSubsequence(one, two);
    post("/api/v1/locations/" + two + "/move", ws.owner().token(), Map.of("beforeId", one));
    assertThat(treeIds(ws.owner(), ws.id(), null, false)).containsSubsequence(two, one);
  }

  @Test
  void createIsIdempotent() {
    Ws ws = workspaceWithAllRoles();
    String key = UUID.randomUUID().toString();
    Map<String, Object> body = Map.of("type", "SPACE", "workspaceId", ws.id(), "name", "Once");
    Resp first = post("/api/v1/locations", ws.owner().token(), body, "Idempotency-Key", key);
    Resp second = post("/api/v1/locations", ws.owner().token(), body, "Idempotency-Key", key);
    assertThat(first.status()).isEqualTo(201);
    assertThat(second.raw()).isEqualTo(first.raw());
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM location WHERE workspace_id = ? AND name = 'Once'",
                Integer.class,
                ws.id()))
        .isEqualTo(1);
  }
}
