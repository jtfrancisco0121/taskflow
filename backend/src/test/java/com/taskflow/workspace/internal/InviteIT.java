package com.taskflow.workspace.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.taskflow.IntegrationTest;
import com.taskflow.shared.Actor;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

@DisplayName("AUTH-4 invites by email link")
class InviteIT extends IntegrationTest {

  private static final Pattern LINK = Pattern.compile("/invite/([A-Za-z0-9_-]+)");

  @Autowired InviteTxProbe probe;

  @AfterEach
  void clear() {
    SecurityContextHolder.clearContext();
  }

  private static String freshEmail() {
    return "invitee+" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
  }

  private String invitesPath(Ws ws) {
    return "/api/v1/workspaces/" + ws.id() + "/invites";
  }

  private String tokenFromMail(String email) {
    List<String> texts = mailpit().textsTo(email, 10_000);
    assertThat(texts).as("mail to %s", email).hasSize(1);
    Matcher m = LINK.matcher(texts.get(0));
    assertThat(m.find()).isTrue();
    return m.group(1);
  }

  private TestUser signUpWithEmail(String email) {
    Resp r =
        post(
            "/api/v1/auth/signup",
            null,
            Map.of("email", email, "password", "correct-horse-battery", "displayName", "Invitee"));
    assertThat(r.status()).isEqualTo(201);
    return new TestUser(r.uuid("/user/id"), email, r.text("/accessToken"));
  }

  @Test
  void theMailReachesMailpitAndAcceptingMakesTheUserAMemberWithTheInvitedRole() {
    Ws ws = workspaceWithAllRoles();
    String email = freshEmail();
    Resp created =
        post(invitesPath(ws), ws.owner().token(), Map.of("email", email, "role", "ADMIN"));
    assertThat(created.status()).isEqualTo(201);
    assertThat(created.text("/status")).isEqualTo("PENDING");
    assertThat(created.raw()).doesNotContain("token");

    String token = tokenFromMail(email);
    Resp preview = get("/api/v1/invites/" + token, null);
    assertThat(preview.status()).isEqualTo(200);
    assertThat(preview.text("/workspaceName")).isEqualTo("Acme Roles");
    assertThat(preview.text("/email")).isEqualTo(email);
    assertThat(preview.text("/role")).isEqualTo("ADMIN");

    TestUser invitee = signUpWithEmail(email);
    Resp accepted = post("/api/v1/invites/" + token + "/accept", invitee.token(), null);
    assertThat(accepted.status()).isEqualTo(200);
    assertThat(accepted.text("/role")).isEqualTo("ADMIN");
    assertThat(accepted.at("/alreadyMember").asBoolean()).isFalse();
    assertThat(get("/api/v1/workspaces/" + ws.id(), invitee.token()).text("/role"))
        .isEqualTo("ADMIN");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE workspace_id = ? AND type = 'member.joined'",
                Integer.class,
                ws.id()))
        .isEqualTo(1);

    Resp again = post("/api/v1/invites/" + token + "/accept", invitee.token(), null);
    assertThat(again.status()).isEqualTo(200);
    assertThat(again.at("/alreadyMember").asBoolean()).isTrue();
    assertThat(get(invitesPath(ws), ws.owner().token()).text("/items/0/status"))
        .isEqualTo("ACCEPTED");
  }

  @Test
  void onlyTheHashOfTheTokenIsStored() {
    Ws ws = workspaceWithAllRoles();
    String email = freshEmail();
    post(invitesPath(ws), ws.owner().token(), Map.of("email", email, "role", "MEMBER"));
    String token = tokenFromMail(email);
    String stored =
        jdbc.queryForObject("SELECT token_hash FROM invite WHERE email = ?", String.class, email);
    assertThat(stored).isNotEqualTo(token).hasSize(64);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM invite WHERE token_hash = ? OR email = ? AND token_hash LIKE ?",
                Integer.class,
                token,
                email,
                "%" + token + "%"))
        .isZero();
  }

  @Test
  void anExpiredInviteIsRefused() {
    Ws ws = workspaceWithAllRoles();
    String email = freshEmail();
    post(invitesPath(ws), ws.owner().token(), Map.of("email", email, "role", "MEMBER"));
    String token = tokenFromMail(email);
    jdbc.update(
        "UPDATE invite SET expires_at = now() - interval '1 minute' WHERE email = ?", email);
    TestUser invitee = signUpWithEmail(email);
    Resp r = post("/api/v1/invites/" + token + "/accept", invitee.token(), null);
    assertThat(r.status()).isEqualTo(410);
    assertThat(r.text("/code")).isEqualTo("invite.expired");
    assertThat(get("/api/v1/invites/" + token, null).status()).isEqualTo(410);
    assertThat(get("/api/v1/workspaces/" + ws.id(), invitee.token()).status()).isEqualTo(404);
  }

  @Test
  void aRevokedInviteIsRefused() {
    Ws ws = workspaceWithAllRoles();
    String email = freshEmail();
    Resp created =
        post(invitesPath(ws), ws.owner().token(), Map.of("email", email, "role", "GUEST"));
    String token = tokenFromMail(email);
    assertThat(delete(invitesPath(ws) + "/" + created.uuid("/id"), ws.admin().token()).status())
        .isEqualTo(204);
    TestUser invitee = signUpWithEmail(email);
    Resp r = post("/api/v1/invites/" + token + "/accept", invitee.token(), null);
    assertThat(r.status()).isEqualTo(410);
    assertThat(r.text("/code")).isEqualTo("invite.revoked");
    assertThat(delete(invitesPath(ws) + "/" + UUID.randomUUID(), ws.owner().token()).status())
        .isEqualTo(404);
  }

  @Test
  void aDifferentSignedInEmailIsRefused() {
    Ws ws = workspaceWithAllRoles();
    String email = freshEmail();
    post(invitesPath(ws), ws.owner().token(), Map.of("email", email, "role", "MEMBER"));
    String token = tokenFromMail(email);
    TestUser other = signUp("Other");
    Resp r = post("/api/v1/invites/" + token + "/accept", other.token(), null);
    assertThat(r.status()).isEqualTo(403);
    assertThat(r.text("/code")).isEqualTo("invite.wrong_email");
    assertThat(get("/api/v1/workspaces/" + ws.id(), other.token()).status()).isEqualTo(404);
    assertThat(post("/api/v1/invites/" + token + "/accept", null, null).status()).isEqualTo(401);
  }

  @Test
  void theEmailMatchIsCaseInsensitive() {
    Ws ws = workspaceWithAllRoles();
    String email = freshEmail();
    post(
        invitesPath(ws),
        ws.owner().token(),
        Map.of("email", email.toUpperCase(), "role", "MEMBER"));
    String token = tokenFromMail(email);
    TestUser invitee = signUpWithEmail(email);
    assertThat(post("/api/v1/invites/" + token + "/accept", invitee.token(), null).status())
        .isEqualTo(200);
  }

  @Test
  void ownerIsNotInvitableAndOnlyOwnerAndAdminMayInvite() {
    Ws ws = workspaceWithAllRoles();
    Resp owner =
        post(invitesPath(ws), ws.owner().token(), Map.of("email", freshEmail(), "role", "OWNER"));
    assertThat(owner.status()).isEqualTo(400);
    assertThat(owner.text("/code")).isEqualTo("invite.owner_not_invitable");

    assertThat(
            post(
                    invitesPath(ws),
                    ws.admin().token(),
                    Map.of("email", freshEmail(), "role", "MEMBER"))
                .status())
        .isEqualTo(201);
    for (String role : new String[] {"MEMBER", "GUEST"}) {
      assertThat(
              post(
                      invitesPath(ws),
                      ws.by(role).token(),
                      Map.of("email", freshEmail(), "role", "MEMBER"))
                  .status())
          .isEqualTo(403);
      assertThat(get(invitesPath(ws), ws.by(role).token()).status()).isEqualTo(403);
    }
    assertThat(
            post(
                    invitesPath(ws),
                    signUp("Out").token(),
                    Map.of("email", freshEmail(), "role", "MEMBER"))
                .status())
        .isEqualTo(404);
  }

  @Test
  void invitingAnExistingMemberIs409AndAnUnknownTokenIs404() {
    Ws ws = workspaceWithAllRoles();
    Resp r =
        post(
            invitesPath(ws),
            ws.owner().token(),
            Map.of("email", ws.member().email(), "role", "MEMBER"));
    assertThat(r.status()).isEqualTo(409);
    assertThat(r.text("/code")).isEqualTo("invite.already_member");
    assertThat(get("/api/v1/invites/not-a-token", null).status()).isEqualTo(404);
  }

  @Test
  void noMailIsSentWhenTheTransactionRollsBack() throws Exception {
    Ws ws = workspaceWithAllRoles();
    String email = freshEmail();
    SecurityContextHolder.getContext()
        .setAuthentication(
            UsernamePasswordAuthenticationToken.authenticated(
                Actor.user(ws.owner().id()), null, List.of()));
    assertThatThrownBy(() -> probe.inviteThenFail(ws.id(), email))
        .isInstanceOf(IllegalStateException.class);
    Thread.sleep(1500);
    assertThat(mailpit().textsTo(email, 0)).isEmpty();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM invite WHERE email = ?", Integer.class, email))
        .isZero();
  }
}
