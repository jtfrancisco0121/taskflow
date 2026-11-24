package com.taskflow.workspace.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Every row of permission-matrix.md, per role (CAP-3, CAP-23). Rows are added story by story; each
 * test names the matrix row it proves.
 */
@DisplayName("AUTH-3 permission matrix")
class PermissionMatrixIT extends IntegrationTest {

  @Test
  void renameTheWorkspace_ownerAndAdminOnly() {
    int[] expected = {200, 200, 403, 403};
    for (int i = 0; i < ROLES.size(); i++) {
      Ws ws = workspaceWithAllRoles();
      Resp r =
          patch(
              "/api/v1/workspaces/" + ws.id(),
              ws.by(ROLES.get(i)).token(),
              Map.of("name", "New Name"));
      assertThat(r.status()).as("rename as %s", ROLES.get(i)).isEqualTo(expected[i]);
    }
  }

  @Test
  void deleteTheWorkspace_ownerOnly() {
    int[] expected = {204, 403, 403, 403};
    for (int i = 0; i < ROLES.size(); i++) {
      Ws ws = workspaceWithAllRoles();
      Resp r = delete("/api/v1/workspaces/" + ws.id(), ws.by(ROLES.get(i)).token());
      assertThat(r.status()).as("delete as %s", ROLES.get(i)).isEqualTo(expected[i]);
    }
  }

  @Test
  void changeARoleOrRemoveAMember_ownerAndAdminNotOwners() {
    int[] changeExpected = {200, 200, 403, 403};
    int[] removeExpected = {204, 204, 403, 403};
    for (int i = 0; i < ROLES.size(); i++) {
      Ws ws = workspaceWithAllRoles();
      UUID target = ws.guest().id();
      Resp change =
          patch(
              "/api/v1/workspaces/" + ws.id() + "/members/" + target,
              ws.by(ROLES.get(i)).token(),
              Map.of("role", "MEMBER"));
      assertThat(change.status())
          .as("change role as %s", ROLES.get(i))
          .isEqualTo(changeExpected[i]);
      Resp remove =
          delete(
              "/api/v1/workspaces/" + ws.id() + "/members/" + target, ws.by(ROLES.get(i)).token());
      assertThat(remove.status()).as("remove as %s", ROLES.get(i)).isEqualTo(removeExpected[i]);
    }
  }

  @Test
  void leaveTheWorkspace_ownerOnlyWhenAnotherOwnerExists() {
    for (int i = 0; i < ROLES.size(); i++) {
      Ws ws = workspaceWithAllRoles();
      Resp r = post("/api/v1/workspaces/" + ws.id() + "/leave", ws.by(ROLES.get(i)).token(), null);
      int expected = i == 0 ? 409 : 204;
      assertThat(r.status()).as("leave as %s", ROLES.get(i)).isEqualTo(expected);
    }
    Ws ws = workspaceWithAllRoles();
    addMember(ws.id(), ws.admin(), "OWNER");
    assertThat(post("/api/v1/workspaces/" + ws.id() + "/leave", ws.owner().token(), null).status())
        .isEqualTo(204);
  }

  @Test
  void readTheWorkspaceAndItsMembers_everyMember() {
    for (String role : ROLES) {
      Ws ws = workspaceWithAllRoles();
      assertThat(get("/api/v1/workspaces/" + ws.id(), ws.by(role).token()).status()).isEqualTo(200);
      assertThat(get("/api/v1/workspaces/" + ws.id() + "/members", ws.by(role).token()).status())
          .isEqualTo(200);
    }
  }

  @Test
  void createEditMoveArchiveDeleteASpace_ownerAndAdminOnly() {
    int[] allowed = {201, 201, 403, 403};
    for (int i = 0; i < ROLES.size(); i++) {
      Ws ws = workspaceWithAllRoles();
      String role = ROLES.get(i);
      Resp create =
          post(
              "/api/v1/locations",
              ws.by(role).token(),
              Map.of("type", "SPACE", "workspaceId", ws.id(), "name", "S"));
      assertThat(create.status()).as("create Space as %s", role).isEqualTo(allowed[i]);
      UUID space = space(ws.owner(), ws.id(), "Target");
      boolean ok = i < 2;
      assertThat(
              patch("/api/v1/locations/" + space, ws.by(role).token(), Map.of("name", "n"))
                  .status())
          .as("edit Space as %s", role)
          .isEqualTo(ok ? 200 : (i == 3 ? 404 : 403));
      assertThat(
              post("/api/v1/locations/" + space + "/archive", ws.by(role).token(), null).status())
          .as("archive Space as %s", role)
          .isEqualTo(ok ? 200 : (i == 3 ? 404 : 403));
      assertThat(delete("/api/v1/locations/" + space, ws.by(role).token()).status())
          .as("delete Space as %s", role)
          .isEqualTo(ok ? 204 : (i == 3 ? 404 : 403));
    }
  }

  @Test
  void createEditMoveArchiveDeleteAFolderOrList_ownerAdminMemberNotGuest() {
    for (int i = 0; i < ROLES.size(); i++) {
      Ws ws = workspaceWithAllRoles();
      String role = ROLES.get(i);
      UUID space = space(ws.owner(), ws.id(), "S");
      UUID other = space(ws.owner(), ws.id(), "Other");
      UUID existing = folder(ws.owner(), space, "Existing");
      boolean ok = i < 3;
      int createStatus =
          post(
                  "/api/v1/locations",
                  ws.by(role).token(),
                  Map.of("type", "FOLDER", "parentId", space, "name", "F"))
              .status();
      assertThat(createStatus).as("create Folder as %s", role).isEqualTo(ok ? 201 : 404);
      int listStatus =
          post(
                  "/api/v1/locations",
                  ws.by(role).token(),
                  Map.of("type", "LIST", "parentId", space, "name", "L"))
              .status();
      assertThat(listStatus).as("create List as %s", role).isEqualTo(ok ? 201 : 404);
      assertThat(
              patch("/api/v1/locations/" + existing, ws.by(role).token(), Map.of("name", "n"))
                  .status())
          .as("edit Folder as %s", role)
          .isEqualTo(ok ? 200 : 404);
      assertThat(
              post(
                      "/api/v1/locations/" + existing + "/move",
                      ws.by(role).token(),
                      Map.of("parentId", other))
                  .status())
          .as("move Folder as %s", role)
          .isEqualTo(ok ? 200 : 404);
      assertThat(
              post("/api/v1/locations/" + existing + "/archive", ws.by(role).token(), null)
                  .status())
          .as("archive Folder as %s", role)
          .isEqualTo(ok ? 200 : 404);
      assertThat(delete("/api/v1/locations/" + existing, ws.by(role).token()).status())
          .as("delete Folder as %s", role)
          .isEqualTo(ok ? 204 : 404);
    }
  }

  @Test
  void readVisibleLocations_everyRoleExceptGuestsWithoutAGrant() {
    for (int i = 0; i < ROLES.size(); i++) {
      Ws ws = workspaceWithAllRoles();
      String role = ROLES.get(i);
      UUID space = space(ws.owner(), ws.id(), "S");
      assertThat(get("/api/v1/locations/" + space, ws.by(role).token()).status())
          .as("read Space as %s", role)
          .isEqualTo(i < 3 ? 200 : 404);
      assertThat(
              get("/api/v1/workspaces/" + ws.id() + "/tree", ws.by(role).token())
                  .at("/items")
                  .size())
          .as("tree as %s", role)
          .isEqualTo(i < 3 ? 1 : 0);
    }
  }
}
