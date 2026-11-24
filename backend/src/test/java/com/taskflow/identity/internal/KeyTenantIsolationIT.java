package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.shared.Hashing;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("SA-2 a key is admin of exactly one Workspace")
class KeyTenantIsolationIT extends ServiceAccountTestBase {

  @Test
  void theKeyReadsAPrivateLocationWithoutAGrantAndNothingOfAnotherWorkspace() {
    Ws mine = workspaceWithAllRoles();
    Ws other = workspaceWithAllRoles();
    UUID secretSpace =
        post(
                "/api/v1/locations",
                mine.owner().token(),
                Map.of(
                    "type", "SPACE", "workspaceId", mine.id(), "name", "Secret", "isPrivate", true))
            .uuid("/id");
    UUID list = list(mine.owner(), secretSpace, "L");
    UUID task = task(mine.owner(), list, "T");
    assertThat(get("/api/v1/locations/" + secretSpace, mine.member().token()).status())
        .isEqualTo(404);

    Agent agent = agent(mine.admin(), mine.id());
    String key = agent.secret();
    assertThat(get("/api/v1/locations/" + secretSpace, key).status()).isEqualTo(200);
    assertThat(get("/api/v1/tasks/" + task, key).status()).isEqualTo(200);

    UUID otherSpace = space(other.owner(), other.id(), "Theirs");
    UUID otherList = list(other.owner(), otherSpace, "L");
    UUID otherTask = task(other.owner(), otherList, "T");
    assertThat(get("/api/v1/tasks/" + otherTask, key).status()).isEqualTo(404);
    assertThat(get("/api/v1/locations/" + otherSpace, key).status()).isEqualTo(404);
    assertThat(get("/api/v1/workspaces/" + other.id(), key).status()).isEqualTo(404);
    assertThat(get("/api/v1/workspaces/" + other.id() + "/tree", key).status()).isEqualTo(404);
    assertThat(post("/api/v1/lists/" + otherList + "/tasks", key, Map.of("title", "x")).status())
        .isEqualTo(404);
    assertThat(get(accountsPath(other.id()), key).status()).isEqualTo(404);
  }

  @Test
  void theKeySeesExactlyItsOneWorkspaceWithRoleAdmin() {
    Ws mine = workspaceWithAllRoles();
    workspaceWithAllRoles();
    Agent agent = agent(mine.admin(), mine.id());
    Resp list = get("/api/v1/workspaces", agent.secret());
    assertThat(list.status()).isEqualTo(200);
    assertThat(list.at("/items")).hasSize(1);
    assertThat(list.text("/items/0/id")).isEqualTo(mine.id().toString());
    assertThat(list.text("/items/0/role")).isEqualTo("ADMIN");
    Resp one = get("/api/v1/workspaces/" + mine.id(), agent.secret());
    assertThat(one.status()).isEqualTo(200);
    assertThat(one.text("/role")).isEqualTo("ADMIN");
    // ADMIN may rename, but not delete (owner only)
    assertThat(
            patch("/api/v1/workspaces/" + mine.id(), agent.secret(), Map.of("name", "Renamed"))
                .status())
        .isEqualTo(200);
    assertThat(delete("/api/v1/workspaces/" + mine.id(), agent.secret()).status()).isEqualTo(403);
  }

  @Test
  void aKeyCannotCreateLeaveOrJoinAWorkspace() {
    Ws mine = workspaceWithAllRoles();
    Agent agent = agent(mine.admin(), mine.id());
    String key = agent.secret();

    Resp create = post("/api/v1/workspaces", key, Map.of("name", "Escape"));
    assertThat(create.status()).isEqualTo(403);
    assertThat(create.text("/code")).isEqualTo("auth.forbidden");

    Resp leave = post("/api/v1/workspaces/" + mine.id() + "/leave", key, null);
    assertThat(leave.status()).isEqualTo(403);
    assertThat(leave.text("/code")).isEqualTo("auth.forbidden");

    String token = Hashing.newToken();
    jdbc.update(
        "INSERT INTO invite (id, workspace_id, email, role, token_hash, invited_by, expires_at)"
            + " VALUES (?, ?, 'someone@example.com', 'ADMIN', ?, ?, ?)",
        UUID.randomUUID(),
        mine.id(),
        Hashing.sha256Hex(token),
        mine.owner().id(),
        Timestamp.from(Instant.now().plus(1, ChronoUnit.DAYS)));
    Resp accept = post("/api/v1/invites/" + token + "/accept", key, null);
    assertThat(accept.status()).isEqualTo(403);
    assertThat(accept.text("/code")).isEqualTo("auth.forbidden");

    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM workspace_member WHERE user_id = ?",
                Integer.class,
                agent.id()))
        .isZero();
    assertThat(get("/api/v1/workspaces", key).at("/items")).hasSize(1);
    // the invite is still pending
    assertThat(
            jdbc.queryForObject(
                "SELECT accepted_at IS NULL FROM invite WHERE token_hash = ?",
                Boolean.class,
                Hashing.sha256Hex(token)))
        .isTrue();
  }

  @Test
  void aKeyOfADeletedWorkspaceIs401() {
    Ws ws = workspaceWithAllRoles();
    Agent agent = agent(ws.admin(), ws.id());
    assertThat(delete("/api/v1/workspaces/" + ws.id(), ws.owner().token()).status()).isEqualTo(204);
    Resp r = get("/api/v1/workspaces", agent.secret());
    assertThat(r.status()).isEqualTo(401);
  }
}
