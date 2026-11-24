package com.taskflow.view.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("VIEW-1 saved views API")
class ViewApiIT extends ViewTestBase {

  @Test
  void anOrGroupNestedInAnAndGroupReadsBackIdentically() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    String json =
        """
        {"v":1,"filter":{"op":"AND","items":[
          {"field":"priority","op":"any_of","value":["URGENT","HIGH"]},
          {"op":"OR","items":[
            {"field":"title","op":"contains","value":"bug"},
            {"field":"assignee","op":"any_of","value":["me"]}]}]},
         "group":"priority","sort":[{"key":"dueDate","dir":"asc"}],
         "columns":[{"field":"title","width":320},{"field":"status","width":120}]}
        """;
    JsonNode config = mapper.readTree(json);
    Resp created = createView(ws.member(), list, "Urgent bugs", "TABLE", "SHARED", config);
    assertThat(created.status()).as(created.raw()).isEqualTo(201);
    Resp read = get("/api/v1/views/" + created.text("/id"), ws.member().token());
    assertThat(read.status()).isEqualTo(200);
    assertThat(read.at("/config")).isEqualTo(config);
  }

  @Test
  void aBadConfigIsRefusedWithAProblem() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    Map<String, Object> badField =
        Map.of("v", 1, "filter", Map.of("field", "nope", "op", "any_of", "value", List.of("x")));
    Resp r = createView(ws.member(), list, "Bad", "LIST", "SHARED", badField);
    assertThat(r.status()).isEqualTo(400);
    assertThat(r.text("/code")).isEqualTo("view.invalid_config");
    assertThat(r.headers().getContentType().toString()).contains("problem+json");
  }

  @Test
  void aNonOwnerCannotEditOrDeleteButTheOwnerAndAnAdminCan() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    UUID id = createView(ws.member(), list, "Mine", "LIST", "SHARED", config()).uuid("/id");
    TestUser other = signUp("Other");
    addMember(ws.id(), other, "MEMBER");
    assertThat(patch("/api/v1/views/" + id, other.token(), Map.of("name", "x")).status())
        .isEqualTo(403);
    assertThat(delete("/api/v1/views/" + id, other.token()).status()).isEqualTo(403);
    assertThat(
            patch("/api/v1/views/" + id, ws.member().token(), Map.of("name", "Renamed")).status())
        .isEqualTo(200);
    assertThat(
            patch("/api/v1/views/" + id, ws.admin().token(), Map.of("name", "By admin")).status())
        .isEqualTo(200);
    assertThat(delete("/api/v1/views/" + id, ws.member().token()).status()).isEqualTo(204);
    assertThat(get("/api/v1/views/" + id, ws.member().token()).status()).isEqualTo(404);
  }

  @Test
  void anArchivedScopeHidesItsViewsAndUnarchiveRestoresThem() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    createView(ws.member(), list, "Kept", "TABLE", "SHARED", config());
    assertThat(names(get("/api/v1/locations/" + list + "/views", ws.member().token())))
        .contains("Kept");
    assertThat(post("/api/v1/locations/" + list + "/archive", ws.owner().token(), null).status())
        .isEqualTo(200);
    assertThat(get("/api/v1/locations/" + list + "/views", ws.member().token()).at("/items"))
        .isEmpty();
    assertThat(post("/api/v1/locations/" + list + "/unarchive", ws.owner().token(), null).status())
        .isEqualTo(200);
    assertThat(names(get("/api/v1/locations/" + list + "/views", ws.member().token())))
        .contains("Kept");
  }

  @Test
  void severalOrdinaryViewsSaveOnALocationAndAtWorkspaceScope() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    for (String n : List.of("A", "B")) {
      assertThat(createView(ws.member(), list, n, "LIST", "SHARED", config()).status())
          .isEqualTo(201);
      assertThat(createWorkspaceView(ws.member(), ws.id(), n, "BOARD", "SHARED").status())
          .isEqualTo(201);
    }
    assertThat(names(get("/api/v1/locations/" + list + "/views", ws.member().token())))
        .containsExactly("List", "Board", "A", "B");
    assertThat(names(get("/api/v1/workspaces/" + ws.id() + "/views", ws.member().token())))
        .containsExactly("List", "Board", "A", "B");
  }

  @Test
  void aSecondStoredListDefaultOnTheSameLocationIsRefused() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    Map<String, Object> body = new HashMap<>();
    body.put("locationId", list);
    body.put("type", "LIST");
    body.put("defaultKind", "LIST");
    body.put("config", config());
    assertThat(post("/api/v1/views", ws.member().token(), body).status()).isEqualTo(201);
    Resp second = post("/api/v1/views", ws.member().token(), body);
    assertThat(second.status()).isEqualTo(409);
    assertThat(second.text("/code")).isEqualTo("view.default_exists");
    Map<String, Object> boardBody = new HashMap<>(body);
    boardBody.put("type", "BOARD");
    boardBody.put("defaultKind", "BOARD");
    assertThat(post("/api/v1/views", ws.member().token(), boardBody).status()).isEqualTo(201);
  }

  @Test
  void aGuestCannotSaveAView() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    put("/api/v1/locations/" + list + "/grants/" + ws.guest().id(), ws.owner().token(), null);
    assertThat(createView(ws.guest(), list, "G", "LIST", "SHARED", config()).status())
        .isEqualTo(403);
    assertThat(createWorkspaceView(ws.guest(), ws.id(), "G", "LIST", "SHARED").status())
        .isEqualTo(403);
  }
}
