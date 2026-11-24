package com.taskflow.workspace.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("AUTH-3 member roles")
class MembersIT extends IntegrationTest {

  private String members(Ws ws) {
    return "/api/v1/workspaces/" + ws.id() + "/members";
  }

  @Test
  void listsMembersWithTheirRoles() {
    Ws ws = workspaceWithAllRoles();
    Resp r = get(members(ws), ws.guest().token());
    assertThat(r.status()).isEqualTo(200);
    assertThat(r.at("/items")).hasSize(4);
    assertThat(r.at("/items/0/email").asText()).isNotBlank();
  }

  @Test
  void anOwnerChangesARoleAndTheChangeIsRecorded() {
    Ws ws = workspaceWithAllRoles();
    Resp r =
        patch(members(ws) + "/" + ws.member().id(), ws.owner().token(), Map.of("role", "ADMIN"));
    assertThat(r.status()).isEqualTo(200);
    assertThat(r.text("/role")).isEqualTo("ADMIN");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE workspace_id = ? AND type = 'member.role_changed'",
                Integer.class,
                ws.id()))
        .isEqualTo(1);
    assertThat(
            patch(
                    members(ws) + "/" + ws.guest().id(),
                    ws.member().token(),
                    Map.of("role", "MEMBER"))
                .status())
        .isEqualTo(200);
  }

  @Test
  void anAdminCannotTouchOwnersOrGrantOwner() {
    Ws ws = workspaceWithAllRoles();
    Resp demote =
        patch(members(ws) + "/" + ws.owner().id(), ws.admin().token(), Map.of("role", "MEMBER"));
    assertThat(demote.status()).isEqualTo(403);
    assertThat(demote.text("/code")).isEqualTo("member.owner_protected");
    Resp promote =
        patch(members(ws) + "/" + ws.member().id(), ws.admin().token(), Map.of("role", "OWNER"));
    assertThat(promote.status()).isEqualTo(403);
    assertThat(delete(members(ws) + "/" + ws.owner().id(), ws.admin().token()).status())
        .isEqualTo(403);
    assertThat(
            patch(members(ws) + "/" + ws.member().id(), ws.admin().token(), Map.of("role", "GUEST"))
                .status())
        .isEqualTo(200);
  }

  @Test
  void aMemberOrGuestCannotChangeRolesOrRemoveMembers() {
    Ws ws = workspaceWithAllRoles();
    for (String role : new String[] {"MEMBER", "GUEST"}) {
      TestUser caller = ws.by(role);
      assertThat(
              patch(members(ws) + "/" + ws.guest().id(), caller.token(), Map.of("role", "ADMIN"))
                  .status())
          .isEqualTo(403);
      assertThat(delete(members(ws) + "/" + ws.admin().id(), caller.token()).status())
          .isEqualTo(403);
    }
  }

  @Test
  void aWorkspaceKeepsItsLastOwner() {
    Ws ws = workspaceWithAllRoles();
    Resp demote =
        patch(members(ws) + "/" + ws.owner().id(), ws.owner().token(), Map.of("role", "ADMIN"));
    assertThat(demote.status()).isEqualTo(409);
    assertThat(demote.text("/code")).isEqualTo("member.last_owner");
    assertThat(delete(members(ws) + "/" + ws.owner().id(), ws.owner().token()).status())
        .isEqualTo(409);
    Resp leave = post("/api/v1/workspaces/" + ws.id() + "/leave", ws.owner().token(), null);
    assertThat(leave.status()).isEqualTo(409);
    assertThat(leave.text("/code")).isEqualTo("member.last_owner");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM workspace_member WHERE workspace_id = ? AND role = 'OWNER'",
                Integer.class,
                ws.id()))
        .isEqualTo(1);
  }

  @Test
  void withASecondOwnerTheFirstMayStepDownOrLeave() {
    Ws ws = workspaceWithAllRoles();
    assertThat(
            patch(members(ws) + "/" + ws.admin().id(), ws.owner().token(), Map.of("role", "OWNER"))
                .status())
        .isEqualTo(200);
    assertThat(post("/api/v1/workspaces/" + ws.id() + "/leave", ws.owner().token(), null).status())
        .isEqualTo(204);
    assertThat(get("/api/v1/workspaces/" + ws.id(), ws.owner().token()).status()).isEqualTo(404);
    assertThat(
            patch(members(ws) + "/" + ws.admin().id(), ws.admin().token(), Map.of("role", "MEMBER"))
                .status())
        .isEqualTo(409);
  }

  @Test
  void membersAndGuestsMayLeave() {
    Ws ws = workspaceWithAllRoles();
    assertThat(post("/api/v1/workspaces/" + ws.id() + "/leave", ws.member().token(), null).status())
        .isEqualTo(204);
    assertThat(post("/api/v1/workspaces/" + ws.id() + "/leave", ws.guest().token(), null).status())
        .isEqualTo(204);
    assertThat(delete(members(ws) + "/" + ws.admin().id(), ws.owner().token()).status())
        .isEqualTo(204);
    assertThat(get(members(ws), ws.owner().token()).at("/items")).hasSize(1);
  }

  @Test
  void concurrentDemotionsOfTwoOwnersLeaveOne() throws Exception {
    Ws ws = workspaceWithAllRoles();
    addMember(ws.id(), ws.admin(), "OWNER");
    java.util.concurrent.CountDownLatch go = new java.util.concurrent.CountDownLatch(1);
    var a =
        java.util.concurrent.CompletableFuture.supplyAsync(() -> {
          await(go);
          return patch(
              members(ws) + "/" + ws.owner().id(), ws.admin().token(), Map.of("role", "MEMBER"));
        });
    var b =
        java.util.concurrent.CompletableFuture.supplyAsync(() -> {
          await(go);
          return patch(
              members(ws) + "/" + ws.admin().id(), ws.owner().token(), Map.of("role", "MEMBER"));
        });
    go.countDown();
    assertThat(java.util.List.of(a.get().status(), b.get().status()))
        .containsExactlyInAnyOrder(200, 409);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM workspace_member WHERE workspace_id = ? AND role = 'OWNER'",
                Integer.class,
                ws.id()))
        .isEqualTo(1);
  }

  private static void await(java.util.concurrent.CountDownLatch latch) {
    try {
      latch.await();
    } catch (InterruptedException e) {
      throw new IllegalStateException(e);
    }
  }
}
