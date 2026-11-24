package com.taskflow.workspace.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("WS-1 workspaces")
class WorkspaceIT extends IntegrationTest {

  @Test
  void aUserInTwoWorkspacesListsBothAndActsInEach() {
    TestUser user = signUp("Two");
    Resp a = post("/api/v1/workspaces", user.token(), Map.of("name", "Alpha Team", "key", "ALP"));
    Resp b = post("/api/v1/workspaces", user.token(), Map.of("name", "Beta Team"));
    assertThat(a.status()).isEqualTo(201);
    assertThat(b.status()).isEqualTo(201);
    assertThat(a.text("/key")).isEqualTo("ALP");
    assertThat(b.text("/key")).isEqualTo("BETA");
    assertThat(a.text("/role")).isEqualTo("OWNER");

    Resp list = get("/api/v1/workspaces", user.token());
    assertThat(list.status()).isEqualTo(200);
    assertThat(list.at("/items")).hasSize(2);
    assertThat(list.at("/nextCursor").isNull()).isTrue();

    for (Resp ws : new Resp[] {a, b}) {
      UUID id = ws.uuid("/id");
      assertThat(get("/api/v1/workspaces/" + id, user.token()).status()).isEqualTo(200);
      assertThat(
              patch("/api/v1/workspaces/" + id, user.token(), Map.of("name", "Renamed " + id))
                  .status())
          .isEqualTo(200);
    }
  }

  @Test
  void aNonMemberGets404OnAWorkspaceTheyDoNotBelongTo() {
    TestUser owner = signUp("Owner");
    TestUser stranger = signUp("Stranger");
    UUID id = createWorkspace(owner, "Private Co");
    Resp r = get("/api/v1/workspaces/" + id, stranger.token());
    assertThat(r.status()).isEqualTo(404);
    assertThat(r.text("/code")).isEqualTo("workspace.not_found");
    assertThat(get("/api/v1/workspaces/" + id + "/members", stranger.token()).status())
        .isEqualTo(404);
    assertThat(patch("/api/v1/workspaces/" + id, stranger.token(), Map.of("name", "x")).status())
        .isEqualTo(404);
    assertThat(delete("/api/v1/workspaces/" + id, stranger.token()).status()).isEqualTo(404);
    assertThat(get("/api/v1/workspaces", stranger.token()).at("/items")).isEmpty();
  }

  @Test
  void aDeletedWorkspaceDisappears() {
    TestUser owner = signUp("Owner");
    UUID id = createWorkspace(owner, "Gone Soon");
    assertThat(delete("/api/v1/workspaces/" + id, owner.token()).status()).isEqualTo(204);
    assertThat(get("/api/v1/workspaces/" + id, owner.token()).status()).isEqualTo(404);
    assertThat(get("/api/v1/workspaces", owner.token()).at("/items")).isEmpty();
  }

  @Test
  void invalidInputGetsAProblemWithErrors() {
    TestUser owner = signUp("Owner");
    Resp blank = post("/api/v1/workspaces", owner.token(), Map.of("name", " "));
    assertThat(blank.status()).isEqualTo(400);
    assertThat(blank.at("/errors")).isNotEmpty();
    Resp badKey =
        post("/api/v1/workspaces", owner.token(), Map.of("name", "Fine", "key", "toolongkey"));
    assertThat(badKey.status()).isEqualTo(400);
  }

  @Test
  void creatingAWorkspaceRecordsEventsAndIsIdempotent() {
    TestUser owner = signUp("Owner");
    String key = UUID.randomUUID().toString();
    Resp first =
        post("/api/v1/workspaces", owner.token(), Map.of("name", "Once"), "Idempotency-Key", key);
    Resp second =
        post("/api/v1/workspaces", owner.token(), Map.of("name", "Once"), "Idempotency-Key", key);
    assertThat(first.status()).isEqualTo(201);
    assertThat(second.raw()).isEqualTo(first.raw());
    UUID id = first.uuid("/id");
    assertThat(
            jdbc.queryForObject("SELECT count(*) FROM workspace WHERE id = ?", Integer.class, id))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE workspace_id = ? AND type = 'workspace.created'",
                Integer.class,
                id))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM activity_event WHERE workspace_id = ? AND type = 'workspace.created'",
                Integer.class,
                id))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM workspace WHERE name = 'Once' AND id IN (SELECT workspace_id FROM"
                    + " workspace_member WHERE user_id = ?)",
                Integer.class,
                owner.id()))
        .isEqualTo(1);
  }
}
