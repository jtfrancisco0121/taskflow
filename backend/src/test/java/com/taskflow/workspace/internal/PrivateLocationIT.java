package com.taskflow.workspace.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("LOC-3 private locations and grants")
class PrivateLocationIT extends IntegrationTest {

  private Resp privateSpace(Ws ws) {
    return post(
        "/api/v1/locations",
        ws.owner().token(),
        Map.of("type", "SPACE", "workspaceId", ws.id(), "name", "Secret", "isPrivate", true));
  }

  private int status(TestUser user, UUID location) {
    return get("/api/v1/locations/" + location, user.token()).status();
  }

  private void grant(Ws ws, UUID location, TestUser user) {
    assertThat(
            put("/api/v1/locations/" + location + "/grants/" + user.id(), ws.owner().token(), null)
                .status())
        .isEqualTo(204);
  }

  @Test
  void aMemberWithoutAGrantGets404OnThePrivateLocationAndItsDescendantsAndTheTree() {
    Ws ws = workspaceWithAllRoles();
    UUID secret = privateSpace(ws).uuid("/id");
    UUID folder = folder(ws.owner(), secret, "F");
    UUID list = list(ws.owner(), folder, "L");
    UUID open = space(ws.owner(), ws.id(), "Open");

    for (UUID id : new UUID[] {secret, folder, list}) {
      assertThat(status(ws.member(), id)).as("member on %s", id).isEqualTo(404);
      assertThat(status(ws.owner(), id)).isEqualTo(200);
      assertThat(status(ws.admin(), id)).isEqualTo(200);
    }
    assertThat(treeIds(ws.member(), ws.id(), null, false)).containsExactly(open);
    assertThat(treeIds(ws.owner(), ws.id(), null, false)).containsExactly(secret, open);
    assertThat(
            get("/api/v1/workspaces/" + ws.id() + "/tree?parentId=" + secret, ws.member().token())
                .status())
        .isEqualTo(404);
  }

  @Test
  void afterAGrantTheMemberSeesItAndRevokingHidesItAgain() {
    Ws ws = workspaceWithAllRoles();
    UUID secret = privateSpace(ws).uuid("/id");
    UUID folder = folder(ws.owner(), secret, "F");
    UUID list = list(ws.owner(), folder, "L");

    grant(ws, secret, ws.member());
    for (UUID id : new UUID[] {secret, folder, list}) {
      assertThat(status(ws.member(), id)).isEqualTo(200);
    }
    assertThat(treeIds(ws.member(), ws.id(), null, false)).contains(secret);
    assertThat(treeIds(ws.member(), ws.id(), secret, false)).containsExactly(folder);

    assertThat(
            delete(
                    "/api/v1/locations/" + secret + "/grants/" + ws.member().id(),
                    ws.admin().token())
                .status())
        .isEqualTo(204);
    for (UUID id : new UUID[] {secret, folder, list}) {
      assertThat(status(ws.member(), id)).isEqualTo(404);
    }
    assertThat(treeIds(ws.member(), ws.id(), null, false)).doesNotContain(secret);
  }

  @Test
  void aPrivateFolderInsideAnOpenSpaceHidesOnlyItsOwnSubtree() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID hidden =
        location(
            ws.owner(),
            Map.of("type", "FOLDER", "parentId", space, "name", "Hidden", "isPrivate", true));
    UUID inside = list(ws.owner(), hidden, "Inside");
    UUID sibling = list(ws.owner(), space, "Sibling");
    assertThat(status(ws.member(), space)).isEqualTo(200);
    assertThat(status(ws.member(), sibling)).isEqualTo(200);
    assertThat(status(ws.member(), hidden)).isEqualTo(404);
    assertThat(status(ws.member(), inside)).isEqualTo(404);
    assertThat(treeIds(ws.member(), ws.id(), space, false)).containsExactly(sibling);
    grant(ws, inside, ws.member());
    assertThat(status(ws.member(), inside))
        .as("a grant deeper down does not open the private folder above")
        .isEqualTo(404);
  }

  @Test
  void aGuestSeesOnlyGrantedSubtreesAndEveryPrivateLocationBelowTheGrantNeedsItsOwn() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID folder = folder(ws.owner(), space, "F");
    UUID inner = list(ws.owner(), folder, "Inner");
    UUID privateBelow =
        location(
            ws.owner(),
            Map.of("type", "LIST", "parentId", space, "name", "PrivateList", "isPrivate", true));
    UUID other = space(ws.owner(), ws.id(), "Other");

    assertThat(status(ws.guest(), space)).isEqualTo(404);
    assertThat(treeIds(ws.guest(), ws.id(), null, false)).isEmpty();

    grant(ws, folder, ws.guest());
    assertThat(status(ws.guest(), folder)).isEqualTo(200);
    assertThat(status(ws.guest(), inner)).isEqualTo(200);
    assertThat(status(ws.guest(), space))
        .as("a grant on a folder does not open its parent")
        .isEqualTo(404);
    assertThat(status(ws.guest(), other)).isEqualTo(404);

    grant(ws, space, ws.guest());
    assertThat(status(ws.guest(), space)).isEqualTo(200);
    assertThat(status(ws.guest(), inner)).isEqualTo(200);
    assertThat(status(ws.guest(), privateBelow))
        .as("a private list below the grant needs its own grant")
        .isEqualTo(404);
    grant(ws, privateBelow, ws.guest());
    assertThat(status(ws.guest(), privateBelow)).isEqualTo(200);
    assertThat(treeIds(ws.guest(), ws.id(), null, false)).containsExactly(space);
    assertThat(status(ws.owner(), privateBelow)).isEqualTo(200);
  }

  @Test
  void onlyOwnerAndAdminCanGrantOrRevoke() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    grant(ws, space, ws.guest());
    String path = "/api/v1/locations/" + space + "/grants/" + ws.guest().id();
    assertThat(put(path, ws.member().token(), null).status()).isEqualTo(403);
    assertThat(delete(path, ws.member().token()).status()).isEqualTo(403);
    assertThat(put(path, ws.guest().token(), null).status()).isEqualTo(403);
    assertThat(get("/api/v1/locations/" + space + "/grants", ws.member().token()).status())
        .isEqualTo(403);
    assertThat(put(path, ws.admin().token(), null).status()).isEqualTo(204);
    assertThat(get("/api/v1/locations/" + space + "/grants", ws.admin().token()).at("/items"))
        .hasSize(1);
    assertThat(delete(path, ws.admin().token()).status()).isEqualTo(204);
    assertThat(get("/api/v1/locations/" + space + "/grants", ws.owner().token()).at("/items"))
        .isEmpty();
  }

  @Test
  void grantingToANonMemberOrOnAHiddenLocationIs404() {
    Ws ws = workspaceWithAllRoles();
    TestUser stranger = signUp("Stranger");
    UUID space = space(ws.owner(), ws.id(), "S");
    assertThat(
            put("/api/v1/locations/" + space + "/grants/" + stranger.id(), ws.owner().token(), null)
                .status())
        .isEqualTo(404);
    UUID secret = privateSpace(ws).uuid("/id");
    assertThat(
            put(
                    "/api/v1/locations/" + secret + "/grants/" + ws.guest().id(),
                    ws.member().token(),
                    null)
                .status())
        .isEqualTo(404);
    assertThat(
            put(
                    "/api/v1/locations/" + UUID.randomUUID() + "/grants/" + ws.guest().id(),
                    ws.owner().token(),
                    null)
                .status())
        .isEqualTo(404);
  }

  @Test
  void aMemberWithoutAGrantCannotCreateUnderOrMoveIntoAPrivateLocation() {
    Ws ws = workspaceWithAllRoles();
    UUID secret = privateSpace(ws).uuid("/id");
    UUID open = space(ws.owner(), ws.id(), "Open");
    UUID mine = list(ws.member(), open, "Mine");
    int before =
        jdbc.queryForObject(
            "SELECT count(*) FROM location WHERE workspace_id = ?", Integer.class, ws.id());

    for (String type : new String[] {"FOLDER", "LIST"}) {
      Resp create =
          post(
              "/api/v1/locations",
              ws.member().token(),
              Map.of("type", type, "parentId", secret, "name", "x"));
      assertThat(create.status()).isEqualTo(404);
    }
    Resp move =
        post(
            "/api/v1/locations/" + mine + "/move", ws.member().token(), Map.of("parentId", secret));
    assertThat(move.status()).isEqualTo(404);
    assertThat(jdbc.queryForObject("SELECT parent_id FROM location WHERE id = ?", UUID.class, mine))
        .isEqualTo(open);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM location WHERE workspace_id = ?", Integer.class, ws.id()))
        .isEqualTo(before);
  }

  @Test
  void aNeighbourInAnInvisibleLocationLooksLikeAMissingOne() {
    Ws ws = workspaceWithAllRoles();
    UUID secret = privateSpace(ws).uuid("/id");
    UUID hiddenList = list(ws.owner(), secret, "Hidden");
    UUID open = space(ws.owner(), ws.id(), "Open");
    UUID mine = list(ws.member(), open, "Mine");
    Resp invisible =
        post(
            "/api/v1/locations/" + mine + "/move",
            ws.member().token(),
            Map.of("beforeId", hiddenList));
    Resp missing =
        post(
            "/api/v1/locations/" + mine + "/move",
            ws.member().token(),
            Map.of("beforeId", UUID.randomUUID()));
    assertThat(invisible.status()).isEqualTo(404);
    assertThat(missing.status()).isEqualTo(404);
    assertThat(invisible.text("/code")).isEqualTo(missing.text("/code"));
  }

  @Test
  void aMemberWhoMakesALocationPrivateKeepsAccessAndOthersLoseIt() {
    Ws ws = workspaceWithAllRoles();
    TestUser second = signUp("Second");
    addMember(ws.id(), second, "MEMBER");
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    assertThat(status(second, list)).isEqualTo(200);
    assertThat(
            patch("/api/v1/locations/" + list, ws.member().token(), Map.of("isPrivate", true))
                .status())
        .isEqualTo(200);
    assertThat(status(ws.member(), list)).isEqualTo(200);
    assertThat(status(second, list)).isEqualTo(404);
    UUID created =
        location(
            ws.member(),
            Map.of("type", "LIST", "parentId", space, "name", "Mine", "isPrivate", true));
    assertThat(status(ws.member(), created)).isEqualTo(200);
    assertThat(status(second, created)).isEqualTo(404);
  }

  @Test
  void aHasChildrenFlagNeverLeaksAHiddenChild() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    location(
        ws.owner(), Map.of("type", "LIST", "parentId", space, "name", "Hidden", "isPrivate", true));
    assertThat(
            get("/api/v1/workspaces/" + ws.id() + "/tree", ws.member().token())
                .at("/items/0/hasChildren")
                .asBoolean())
        .isFalse();
    assertThat(
            get("/api/v1/workspaces/" + ws.id() + "/tree", ws.owner().token())
                .at("/items/0/hasChildren")
                .asBoolean())
        .isTrue();
  }

  @Test
  void leavingTheWorkspaceDropsTheGrants() {
    Ws ws = workspaceWithAllRoles();
    UUID secret = privateSpace(ws).uuid("/id");
    grant(ws, secret, ws.member());
    assertThat(post("/api/v1/workspaces/" + ws.id() + "/leave", ws.member().token(), null).status())
        .isEqualTo(204);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM location_grant WHERE workspace_id = ? AND user_id = ?",
                Integer.class,
                ws.id(),
                ws.member().id()))
        .isZero();
  }
}
