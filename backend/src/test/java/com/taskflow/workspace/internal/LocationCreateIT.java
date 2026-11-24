package com.taskflow.workspace.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("LOC-1 who may create what, and second targets")
class LocationCreateIT extends IntegrationTest {

  @Test
  void aMemberCannotCreateASpaceButOwnerAndAdminCan() {
    Ws ws = workspaceWithAllRoles();
    Map<String, Object> body = Map.of("type", "SPACE", "workspaceId", ws.id(), "name", "S");
    assertThat(post("/api/v1/locations", ws.member().token(), body).status()).isEqualTo(403);
    assertThat(post("/api/v1/locations", ws.guest().token(), body).status()).isEqualTo(403);
    assertThat(post("/api/v1/locations", ws.admin().token(), body).status()).isEqualTo(201);
    assertThat(post("/api/v1/locations", ws.owner().token(), body).status()).isEqualTo(201);
  }

  @Test
  void aParentFromAnotherWorkspaceOrAMissingParentGives404() {
    Ws mine = workspaceWithAllRoles();
    Ws other = workspaceWithAllRoles();
    UUID foreignSpace = space(other.owner(), other.id(), "Foreign");
    Resp foreign =
        post(
            "/api/v1/locations",
            mine.member().token(),
            Map.of("type", "LIST", "parentId", foreignSpace, "name", "x"));
    assertThat(foreign.status()).isEqualTo(404);
    Resp missing =
        post(
            "/api/v1/locations",
            mine.member().token(),
            Map.of("type", "LIST", "parentId", UUID.randomUUID(), "name", "x"));
    assertThat(missing.status()).isEqualTo(404);
    Resp foreignWorkspace =
        post(
            "/api/v1/locations",
            mine.owner().token(),
            Map.of("type", "SPACE", "workspaceId", other.id(), "name", "x"));
    assertThat(foreignWorkspace.status()).isEqualTo(404);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM location WHERE workspace_id = ? AND name = 'x'",
                Integer.class,
                other.id()))
        .isZero();
  }

  @Test
  void movingUnderAParentNeedsEditOnThatParentAndTheNeighboursMustBeSiblings() {
    Ws ws = workspaceWithAllRoles();
    Ws other = workspaceWithAllRoles();
    UUID spaceA = space(ws.owner(), ws.id(), "A");
    UUID spaceB = space(ws.owner(), ws.id(), "B");
    UUID list = list(ws.member(), spaceA, "L");
    UUID inB = list(ws.member(), spaceB, "InB");
    UUID inA = list(ws.member(), spaceA, "InA");
    UUID foreignSpace = space(other.owner(), other.id(), "Foreign");
    UUID foreignList = list(other.owner(), foreignSpace, "FL");

    assertThat(
            post(
                    "/api/v1/locations/" + list + "/move",
                    ws.guest().token(),
                    Map.of("parentId", spaceB))
                .status())
        .isEqualTo(404);
    assertThat(
            post(
                    "/api/v1/locations/" + list + "/move",
                    ws.member().token(),
                    Map.of("parentId", foreignSpace))
                .status())
        .isEqualTo(404);
    Resp outOfScope =
        post(
            "/api/v1/locations/" + list + "/move",
            ws.member().token(),
            Map.of("parentId", spaceB, "beforeId", inA));
    assertThat(outOfScope.status()).isEqualTo(400);
    assertThat(outOfScope.text("/code")).isEqualTo("rank.neighbour_out_of_scope");
    assertThat(
            post(
                    "/api/v1/locations/" + list + "/move",
                    ws.member().token(),
                    Map.of("parentId", spaceB, "beforeId", foreignList))
                .status())
        .isEqualTo(404);
    assertThat(jdbc.queryForObject("SELECT parent_id FROM location WHERE id = ?", UUID.class, list))
        .isEqualTo(spaceA);

    Resp ok =
        post(
            "/api/v1/locations/" + list + "/move",
            ws.member().token(),
            Map.of("parentId", spaceB, "beforeId", inB));
    assertThat(ok.status()).isEqualTo(200);
    assertThat(treeIds(ws.member(), ws.id(), spaceB, false)).containsExactly(list, inB);
  }

  @Test
  void aMemberCannotEditMoveArchiveOrDeleteASpace() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    assertThat(
            patch("/api/v1/locations/" + space, ws.member().token(), Map.of("name", "n")).status())
        .isEqualTo(403);
    assertThat(post("/api/v1/locations/" + space + "/archive", ws.member().token(), null).status())
        .isEqualTo(403);
    assertThat(delete("/api/v1/locations/" + space, ws.member().token()).status()).isEqualTo(403);
    assertThat(post("/api/v1/locations/" + space + "/move", ws.member().token(), Map.of()).status())
        .isEqualTo(403);
  }
}
