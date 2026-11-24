package com.taskflow.view.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("VIEW-2 visibility and default views")
class ViewVisibilityIT extends ViewTestBase {

  @Test
  void sharedPersonalAndPrivateViewsAreListedForTheRightUsers() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    TestUser friend = signUp("Friend");
    addMember(ws.id(), friend, "MEMBER");
    createView(ws.member(), list, "shared", "LIST", "SHARED", config());
    createView(ws.member(), list, "personal", "LIST", "PERSONAL", config());
    Resp priv =
        post(
            "/api/v1/views",
            ws.member().token(),
            Map.of(
                "locationId",
                list,
                "name",
                "private",
                "type",
                "LIST",
                "visibility",
                "PRIVATE",
                "config",
                config(),
                "shareWith",
                List.of(friend.id())));
    assertThat(priv.status()).as(priv.raw()).isEqualTo(201);
    String path = "/api/v1/locations/" + list + "/views";
    assertThat(names(get(path, ws.member().token()))).contains("shared", "personal", "private");
    assertThat(names(get(path, friend.token())))
        .contains("shared", "private")
        .doesNotContain("personal");
    assertThat(names(get(path, ws.admin().token())))
        .contains("shared")
        .doesNotContain("personal", "private");
    // removing the share hides the view again
    UUID id = priv.uuid("/id");
    assertThat(
            patch("/api/v1/views/" + id, ws.member().token(), Map.of("shareWith", List.of()))
                .status())
        .isEqualTo(200);
    assertThat(names(get(path, friend.token()))).doesNotContain("private");
    assertThat(get("/api/v1/views/" + id, friend.token()).status()).isEqualTo(404);
  }

  @Test
  void everyNewLocationListsOneListAndOneBoardDefault() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID folder = folder(ws.member(), space, "F");
    UUID list = list(ws.member(), folder, "L");
    for (UUID location : List.of(space, folder, list)) {
      Resp r = get("/api/v1/locations/" + location + "/views", ws.member().token());
      assertThat(r.status()).isEqualTo(200);
      assertThat(r.at("/items")).hasSize(2);
      assertThat(r.at("/items/0/defaultKind").asText()).isEqualTo("LIST");
      assertThat(r.at("/items/0/id").isNull()).isTrue();
      assertThat(r.at("/items/1/defaultKind").asText()).isEqualTo("BOARD");
    }
    Resp home = get("/api/v1/workspaces/" + ws.id() + "/views", ws.member().token());
    assertThat(home.at("/items")).hasSize(2);
    assertThat(jdbc.queryForObject("SELECT count(*) FROM view", Integer.class)).isZero();
  }

  @Test
  void savingADefaultReplacesTheVirtualOneAndDeletingRevertsIt() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    createView(ws.member(), list, "Extra", "TABLE", "SHARED", config());
    Resp saved =
        post(
            "/api/v1/views",
            ws.member().token(),
            Map.of(
                "locationId",
                list,
                "type",
                "BOARD",
                "defaultKind",
                "BOARD",
                "config",
                Map.of("v", 1, "group", "priority")));
    assertThat(saved.status()).as(saved.raw()).isEqualTo(201);
    String path = "/api/v1/locations/" + list + "/views";
    Resp after = get(path, ws.member().token());
    assertThat(after.at("/items/0/defaultKind").asText()).isEqualTo("LIST");
    assertThat(after.at("/items/1/id").asText()).isEqualTo(saved.text("/id"));
    assertThat(after.at("/items/1/config/group").asText()).isEqualTo("priority");
    assertThat(after.at("/items")).hasSize(3);
    delete("/api/v1/views/" + saved.text("/id"), ws.member().token());
    Resp reverted = get(path, ws.member().token());
    assertThat(reverted.at("/items/1/id").isNull()).isTrue();
    assertThat(reverted.at("/items/1/config/group").asText()).isEqualTo("status");
  }
}
