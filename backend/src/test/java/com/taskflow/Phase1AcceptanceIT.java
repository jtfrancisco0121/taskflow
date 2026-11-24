package com.taskflow;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The PRD Phase 1 acceptance lines as one flow. */
@DisplayName("Phase 1 acceptance (AUTH, WS, LOC, TASK, STAT)")
class Phase1AcceptanceIT extends IntegrationTest {

  private List<UUID> taskIds(TestUser user, String scope) {
    List<UUID> out = new ArrayList<>();
    String cursor = null;
    do {
      Resp r =
          get(
              "/api/v1/tasks?" + scope + "&limit=2" + (cursor == null ? "" : "&cursor=" + cursor),
              user.token());
      assertThat(r.status()).as(r.raw()).isEqualTo(200);
      for (JsonNode n : r.at("/items")) {
        out.add(UUID.fromString(n.get("id").asText()));
      }
      cursor = r.at("/nextCursor").isNull() ? null : r.text("/nextCursor");
    } while (cursor != null);
    return out;
  }

  @Test
  void aNewUserCreatesAWorkspaceInvitesASecondUserWhoJoinsAndSeesOnlyWhatTheRoleAllows() {
    TestUser owner = signUp("Founder");
    UUID workspace = createWorkspace(owner, "Acceptance Co");
    UUID openSpace = space(owner, workspace, "Open");
    UUID privateSpace =
        location(
            owner,
            Map.of("type", "SPACE", "workspaceId", workspace, "name", "Board", "isPrivate", true));
    UUID openList = list(owner, openSpace, "Open list");
    UUID privateList = list(owner, privateSpace, "Private list");
    UUID openTask = task(owner, openList, "Visible work");
    UUID privateTask = task(owner, privateList, "Secret work");

    String email = "second+" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    assertThat(
            post(
                    "/api/v1/workspaces/" + workspace + "/invites",
                    owner.token(),
                    Map.of("email", email, "role", "GUEST"))
                .status())
        .isEqualTo(201);
    List<String> mails = mailpit().textsTo(email, 10_000);
    assertThat(mails).hasSize(1);
    Matcher m = Pattern.compile("/invite/([A-Za-z0-9_-]+)").matcher(mails.get(0));
    assertThat(m.find()).isTrue();
    String token = m.group(1);

    Resp signup =
        post(
            "/api/v1/auth/signup",
            null,
            Map.of("email", email, "password", "correct-horse-battery", "displayName", "Second"));
    TestUser second = new TestUser(signup.uuid("/user/id"), email, signup.text("/accessToken"));
    assertThat(get("/api/v1/workspaces/" + workspace, second.token()).status())
        .as("not a member yet")
        .isEqualTo(404);
    assertThat(post("/api/v1/invites/" + token + "/accept", second.token(), null).status())
        .isEqualTo(200);

    // A guest sees nothing until granted, then only the granted subtree.
    assertThat(get("/api/v1/workspaces/" + workspace, second.token()).text("/role"))
        .isEqualTo("GUEST");
    assertThat(treeIds(second, workspace, null, false)).isEmpty();
    assertThat(get("/api/v1/tasks/" + openTask, second.token()).status()).isEqualTo(404);
    put("/api/v1/locations/" + openSpace + "/grants/" + second.id(), owner.token(), null);
    assertThat(treeIds(second, workspace, null, false)).containsExactly(openSpace);
    assertThat(get("/api/v1/tasks/" + openTask, second.token()).status()).isEqualTo(200);
    assertThat(get("/api/v1/tasks/" + privateTask, second.token()).status()).isEqualTo(404);
    assertThat(taskIds(second, "workspaceId=" + workspace)).containsExactly(openTask);
    assertThat(
            post("/api/v1/lists/" + openList + "/tasks", second.token(), Map.of("title", "x"))
                .status())
        .isEqualTo(403);
  }

  @Test
  void aNestedTaskAppearsInEveryAncestorScope() {
    TestUser owner = signUp("Nest");
    UUID workspace = createWorkspace(owner, "Nest Co");
    UUID space = space(owner, workspace, "S");
    UUID folder = folder(owner, space, "F");
    UUID list =
        jdbc.queryForObject("SELECT id FROM location WHERE parent_id = ?", UUID.class, folder);
    UUID parent = task(owner, list, "parent");
    UUID child =
        post(
                "/api/v1/lists/" + list + "/tasks",
                owner.token(),
                Map.of("title", "child", "parentTaskId", parent))
            .uuid("/id");
    for (String scope :
        List.of(
            "locationId=" + list,
            "locationId=" + folder,
            "locationId=" + space,
            "workspaceId=" + workspace)) {
      assertThat(taskIds(owner, scope)).as(scope).containsExactlyInAnyOrder(parent, child);
    }
  }

  @Test
  void twoUsersEditingOneTaskNeverSilentlyOverwriteEachOther() {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    UUID task = task(ws.member(), list, "shared");
    Resp mine = get("/api/v1/tasks/" + task, ws.member().token());
    Resp theirs = get("/api/v1/tasks/" + task, ws.admin().token());
    String etagMine = mine.headers().getFirst("ETag");
    String etagTheirs = theirs.headers().getFirst("ETag");

    assertThat(
            patch(
                    "/api/v1/tasks/" + task,
                    ws.member().token(),
                    Map.of("title", "Member's edit"),
                    "If-Match",
                    etagMine)
                .status())
        .isEqualTo(200);
    Resp conflict =
        patch(
            "/api/v1/tasks/" + task,
            ws.admin().token(),
            Map.of("priority", "URGENT"),
            "If-Match",
            etagTheirs);
    assertThat(conflict.status()).isEqualTo(409);
    assertThat(conflict.text("/current/title")).isEqualTo("Member's edit");
    assertThat(conflict.at("/current/version").asLong()).isEqualTo(2);
    assertThat(get("/api/v1/tasks/" + task, ws.owner().token()).text("/priority"))
        .isEqualTo("NONE");
  }

  @Test
  void aSpaceStatusChangeReachesInheritingListsOnly() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID inheriting = list(ws.member(), space, "Inheriting");
    UUID overriding = list(ws.member(), space, "Overriding");
    Resp before = get("/api/v1/locations/" + space + "/statuses", ws.owner().token());
    List<Map<String, Object>> toBacklog = new ArrayList<>();
    List<Map<String, Object>> keep = new ArrayList<>();
    for (JsonNode s : before.at("/statuses")) {
      toBacklog.add(
          Map.of(
              "from",
              s.get("id").asText(),
              "to",
              s.get("group").asText().matches("NOT_STARTED|ACTIVE") ? "backlog" : "shipped"));
      keep.add(
          Map.of(
              "id",
              s.get("id").asText(),
              "name",
              s.get("name").asText().equals("to do") ? "queued" : s.get("name").asText(),
              "group",
              s.get("group").asText()));
    }
    put(
        "/api/v1/locations/" + overriding + "/statuses",
        ws.member().token(),
        Map.of(
            "statuses",
            List.of(
                Map.of("name", "backlog", "group", "NOT_STARTED"),
                Map.of("name", "shipped", "group", "DONE")),
            "remap",
            toBacklog));

    Resp changed =
        put(
            "/api/v1/locations/" + space + "/statuses",
            ws.owner().token(),
            Map.of("statuses", keep));
    assertThat(changed.status()).as(changed.raw()).isEqualTo(200);
    List<String> inheritingNames = new ArrayList<>();
    get("/api/v1/locations/" + inheriting + "/statuses", ws.member().token())
        .at("/statuses")
        .forEach(s -> inheritingNames.add(s.get("name").asText()));
    List<String> overridingNames = new ArrayList<>();
    get("/api/v1/locations/" + overriding + "/statuses", ws.member().token())
        .at("/statuses")
        .forEach(s -> overridingNames.add(s.get("name").asText()));
    assertThat(inheritingNames).containsExactly("queued", "in progress", "complete", "closed");
    assertThat(overridingNames).containsExactly("backlog", "shipped");
  }
}
