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

  @Test
  void grantOrRevokePrivateAccess_ownerAndAdminOnly() {
    for (int i = 0; i < ROLES.size(); i++) {
      Ws ws = workspaceWithAllRoles();
      String role = ROLES.get(i);
      UUID space = space(ws.owner(), ws.id(), "S");
      assertThat(
              put(
                      "/api/v1/locations/" + space + "/grants/" + ws.guest().id(),
                      ws.owner().token(),
                      null)
                  .status())
          .isEqualTo(204);
      String path = "/api/v1/locations/" + space + "/grants/" + ws.member().id();
      int expected = i < 2 ? 204 : 403;
      assertThat(put(path, ws.by(role).token(), null).status())
          .as("grant as %s", role)
          .isEqualTo(expected);
      assertThat(delete(path, ws.by(role).token()).status())
          .as("revoke as %s", role)
          .isEqualTo(expected);
    }
  }

  @Test
  void aGuestReadsOnlyWhatIsGranted() {
    Ws ws = workspaceWithAllRoles();
    UUID granted = space(ws.owner(), ws.id(), "Granted");
    UUID notGranted = space(ws.owner(), ws.id(), "NotGranted");
    put("/api/v1/locations/" + granted + "/grants/" + ws.guest().id(), ws.owner().token(), null);
    assertThat(get("/api/v1/locations/" + granted, ws.guest().token()).status()).isEqualTo(200);
    assertThat(get("/api/v1/locations/" + notGranted, ws.guest().token()).status()).isEqualTo(404);
    assertThat(
            post(
                    "/api/v1/locations",
                    ws.guest().token(),
                    Map.of("type", "LIST", "parentId", granted, "name", "x"))
                .status())
        .isEqualTo(403);
  }

  @Test
  void defineOrResetStatuses_memberOnlyOnFolderAndList() {
    for (int i = 0; i < ROLES.size(); i++) {
      Ws ws = workspaceWithAllRoles();
      String role = ROLES.get(i);
      UUID space = space(ws.owner(), ws.id(), "S");
      UUID folder = folder(ws.owner(), space, "F");
      Resp set = get("/api/v1/locations/" + space + "/statuses", ws.owner().token());
      java.util.List<Map<String, Object>> all = new java.util.ArrayList<>();
      for (var s : set.at("/statuses")) {
        all.add(
            Map.of(
                "id",
                s.get("id").asText(),
                "name",
                s.get("name").asText(),
                "group",
                s.get("group").asText()));
      }
      Map<String, Object> keepAll = Map.of("statuses", all);
      int onSpace = i < 2 ? 200 : (i == 2 ? 403 : 404);
      int onFolder = i < 3 ? 200 : 404;
      assertThat(
              put("/api/v1/locations/" + space + "/statuses", ws.by(role).token(), keepAll)
                  .status())
          .as("define on Space as %s", role)
          .isEqualTo(onSpace);
      assertThat(
              put(
                      "/api/v1/locations/" + folder + "/statuses",
                      ws.by(role).token(),
                      Map.of(
                          "statuses",
                          java.util.List.of(
                              Map.of("name", "a", "group", "NOT_STARTED"),
                              Map.of("name", "b", "group", "DONE")),
                          "remap",
                          remapAll(all, "a", "b")))
                  .status())
          .as("define on Folder as %s", role)
          .isEqualTo(onFolder);
    }
  }

  private static java.util.List<Map<String, Object>> remapAll(
      java.util.List<Map<String, Object>> set, String first, String last) {
    java.util.List<Map<String, Object>> out = new java.util.ArrayList<>();
    for (Map<String, Object> s : set) {
      boolean start = "NOT_STARTED".equals(s.get("group")) || "ACTIVE".equals(s.get("group"));
      out.add(Map.of("from", s.get("id"), "to", start ? first : last));
    }
    return out;
  }

  @Test
  void createAndEditTasks_ownerAdminMemberNotGuest() {
    for (int i = 0; i < ROLES.size(); i++) {
      Ws ws = workspaceWithAllRoles();
      String role = ROLES.get(i);
      UUID space = space(ws.owner(), ws.id(), "S");
      UUID list = list(ws.owner(), space, "L");
      UUID existing = task(ws.owner(), list, "t");
      put("/api/v1/locations/" + space + "/grants/" + ws.guest().id(), ws.owner().token(), null);
      boolean ok = i < 3;
      Resp create =
          post("/api/v1/lists/" + list + "/tasks", ws.by(role).token(), Map.of("title", "x"));
      assertThat(create.status()).as("create task as %s", role).isEqualTo(ok ? 201 : 403);
      Resp edit = patchTask(ws.by(role), existing, 1, Map.of("title", "y"));
      assertThat(edit.status()).as("edit task as %s", role).isEqualTo(ok ? 200 : 403);
      assertThat(get("/api/v1/tasks/" + existing, ws.by(role).token()).status())
          .as("read task as %s", role)
          .isEqualTo(200);
    }
  }

  @Test
  void moveDuplicateDeleteRestoreTasksAndEditChecklists_ownerAdminMemberNotGuest() {
    for (int i = 0; i < ROLES.size(); i++) {
      Ws ws = workspaceWithAllRoles();
      String role = ROLES.get(i);
      UUID space = space(ws.owner(), ws.id(), "S");
      UUID list = list(ws.owner(), space, "L");
      UUID other = list(ws.owner(), space, "Other");
      put("/api/v1/locations/" + space + "/grants/" + ws.guest().id(), ws.owner().token(), null);
      UUID toMove = task(ws.owner(), list, "m");
      UUID toCopy = task(ws.owner(), list, "c");
      UUID toDelete = task(ws.owner(), list, "d");
      UUID toCheck = task(ws.owner(), list, "k");
      boolean ok = i < 3;
      String token = ws.by(role).token();
      assertThat(
              post(
                      "/api/v1/tasks/" + toMove + "/move",
                      token,
                      Map.of("listId", other),
                      "If-Match",
                      "\"1\"")
                  .status())
          .as("move as %s", role)
          .isEqualTo(ok ? 200 : 403);
      assertThat(post("/api/v1/tasks/" + toCopy + "/duplicate", token, Map.of()).status())
          .as("duplicate as %s", role)
          .isEqualTo(ok ? 201 : 403);
      assertThat(delete("/api/v1/tasks/" + toDelete, token, "If-Match", "\"1\"").status())
          .as("delete as %s", role)
          .isEqualTo(ok ? 204 : 403);
      assertThat(
              post("/api/v1/tasks/" + toDelete + "/restore", token, null, "If-Match", "\"2\"")
                  .status())
          .as("restore as %s", role)
          .isEqualTo(ok ? 200 : 403);
      assertThat(
              post("/api/v1/tasks/" + toCheck + "/checklists", token, Map.of("name", "c")).status())
          .as("checklist as %s", role)
          .isEqualTo(ok ? 201 : 403);
    }
  }

  @Test
  void commentOnAVisibleTaskAndEditOrDeleteOnlyYourOwn_everyRole() {
    for (int i = 0; i < ROLES.size(); i++) {
      Ws ws = workspaceWithAllRoles();
      String role = ROLES.get(i);
      UUID space = space(ws.owner(), ws.id(), "S");
      UUID list = list(ws.owner(), space, "L");
      UUID task = task(ws.owner(), list, "t");
      put("/api/v1/locations/" + space + "/grants/" + ws.guest().id(), ws.owner().token(), null);
      Map<String, Object> doc =
          Map.of(
              "body",
              Map.of("type", "doc", "content", java.util.List.of(Map.of("type", "paragraph"))));
      UUID others =
          post("/api/v1/tasks/" + task + "/comments", ws.owner().token(), doc).uuid("/id");
      if (i == 0) {
        others = post("/api/v1/tasks/" + task + "/comments", ws.member().token(), doc).uuid("/id");
      }
      Resp mine = post("/api/v1/tasks/" + task + "/comments", ws.by(role).token(), doc);
      assertThat(mine.status()).as("comment as %s", role).isEqualTo(201);
      assertThat(patch("/api/v1/comments/" + mine.uuid("/id"), ws.by(role).token(), doc).status())
          .as("edit own as %s", role)
          .isEqualTo(200);
      assertThat(patch("/api/v1/comments/" + others, ws.by(role).token(), doc).status())
          .as("edit another's as %s", role)
          .isEqualTo(403);
      assertThat(delete("/api/v1/comments/" + others, ws.by(role).token()).status())
          .as("delete another's as %s", role)
          .isEqualTo(403);
      assertThat(delete("/api/v1/comments/" + mine.uuid("/id"), ws.by(role).token()).status())
          .as("delete own as %s", role)
          .isEqualTo(204);
    }
  }

  @Test
  void inviteAndRevokeInvites_ownerAndAdminOnly() {
    for (int i = 0; i < ROLES.size(); i++) {
      Ws ws = workspaceWithAllRoles();
      String role = ROLES.get(i);
      String email = "matrix+" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
      Resp invite =
          post(
              "/api/v1/workspaces/" + ws.id() + "/invites",
              ws.by(role).token(),
              Map.of("email", email, "role", "MEMBER"));
      assertThat(invite.status()).as("invite as %s", role).isEqualTo(i < 2 ? 201 : 403);
      Resp existing =
          post(
              "/api/v1/workspaces/" + ws.id() + "/invites",
              ws.owner().token(),
              Map.of("email", email + ".x", "role", "GUEST"));
      assertThat(existing.status()).isEqualTo(201);
      Resp revoke =
          delete(
              "/api/v1/workspaces/" + ws.id() + "/invites/" + existing.uuid("/id"),
              ws.by(role).token());
      assertThat(revoke.status()).as("revoke as %s", role).isEqualTo(i < 2 ? 204 : 403);
    }
  }
}
