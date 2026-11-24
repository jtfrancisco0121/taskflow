package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("SA-1..4, KEY-1..5 service account and key management")
class ServiceAccountIT extends ServiceAccountTestBase {

  @Test
  void ownersAndAdminsCreateAndListWhileMembersAndGuestsGet403() {
    Ws ws = workspaceWithAllRoles();
    for (String role : new String[] {"OWNER", "ADMIN"}) {
      Resp created =
          post(accountsPath(ws.id()), ws.by(role).token(), Map.of("name", "bot-" + role));
      assertThat(created.status()).isEqualTo(201);
      assertThat(created.text("/name")).isEqualTo("bot-" + role);
      assertThat(created.at("/disabled").asBoolean()).isFalse();
    }
    Resp list = get(accountsPath(ws.id()), ws.admin().token());
    assertThat(list.status()).isEqualTo(200);
    assertThat(list.at("/items")).hasSize(2);
    for (String role : new String[] {"MEMBER", "GUEST"}) {
      TestUser user = ws.by(role);
      assertThat(post(accountsPath(ws.id()), user.token(), Map.of("name", "x")).status())
          .isEqualTo(403);
      assertThat(get(accountsPath(ws.id()), user.token()).status()).isEqualTo(403);
    }
    // not a member at all: the Workspace is not visible
    assertThat(get(accountsPath(ws.id()), signUp("Stranger").token()).status()).isEqualTo(404);
  }

  @Test
  void aDuplicateNameIsAConflictCaseInsensitively() {
    Ws ws = workspaceWithAllRoles();
    createAccount(ws.admin(), ws.id(), "Triage");
    Resp dup = post(accountsPath(ws.id()), ws.admin().token(), Map.of("name", "triage"));
    assertThat(dup.status()).isEqualTo(409);
    assertThat(dup.text("/code")).isEqualTo("service_account.name_taken");
  }

  @Test
  void aServiceAccountNeverBecomesAMember() {
    Ws ws = workspaceWithAllRoles();
    UUID account = createAccount(ws.admin(), ws.id(), "bot");
    Resp members = get("/api/v1/workspaces/" + ws.id() + "/members", ws.admin().token());
    assertThat(members.at("/items").toString()).doesNotContain(account.toString());
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM workspace_member WHERE user_id = ?", Integer.class, account))
        .isZero();
    assertThat(jdbc.queryForObject("SELECT kind FROM app_user WHERE id = ?", String.class, account))
        .isEqualTo("SERVICE_ACCOUNT");
  }

  @Test
  void theSecretIsShownOnceAndOnlyAHashIsStored() {
    Ws ws = workspaceWithAllRoles();
    UUID account = createAccount(ws.admin(), ws.id(), "bot");
    Resp created = createKeyResp(ws.admin(), ws.id(), account, "CI-1");
    assertThat(created.status()).isEqualTo(201);
    String secret = created.text("/secret");
    assertThat(secret).startsWith("tf_sk_").hasSize(6 + 43);
    assertThat(created.text("/key/last4")).isEqualTo(secret.substring(secret.length() - 4));
    assertThat(created.headers().getCacheControl()).contains("no-store");

    String keys =
        get(accountsPath(ws.id()) + "/" + account + "/api-keys", ws.admin().token()).raw();
    assertThat(keys).doesNotContain(secret).contains("CI-1").contains("ACTIVE");
    assertThat(get(accountsPath(ws.id()) + "/" + account, ws.admin().token()).raw())
        .doesNotContain(secret);
    assertThat(get(accountsPath(ws.id()), ws.admin().token()).raw()).doesNotContain(secret);

    // SM-3: no column of any identity table, nor any event payload, holds the secret
    for (String table :
        new String[] {"api_key", "service_account", "app_user", "api_key_usage_daily"}) {
      assertThat(
              jdbc.queryForObject(
                  "SELECT count(*) FROM " + table + " t WHERE t::text LIKE ?",
                  Integer.class,
                  "%" + secret + "%"))
          .as(table)
          .isZero();
    }
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM activity_event WHERE payload::text LIKE ?",
                Integer.class,
                "%" + secret + "%"))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT key_hash FROM api_key WHERE id = ?", String.class, created.uuid("/key/id")))
        .isEqualTo(com.taskflow.shared.Hashing.sha256Hex(secret));
  }

  @Test
  void aPastExpiryIs422() {
    Ws ws = workspaceWithAllRoles();
    UUID account = createAccount(ws.admin(), ws.id(), "bot");
    Resp r =
        post(
            accountsPath(ws.id()) + "/" + account + "/api-keys",
            ws.admin().token(),
            Map.of("name", "old", "expiresAt", Instant.now().minus(1, ChronoUnit.DAYS).toString()));
    assertThat(r.status()).isEqualTo(422);
    assertThat(r.text("/code")).isEqualTo("api_key.expiry_in_past");
    Resp future =
        post(
            accountsPath(ws.id()) + "/" + account + "/api-keys",
            ws.admin().token(),
            Map.of("name", "new", "expiresAt", Instant.now().plus(30, ChronoUnit.DAYS).toString()));
    assertThat(future.status()).isEqualTo(201);
    assertThat(future.at("/key/expiresAt").isNull()).isFalse();
  }

  @Test
  void severalKeysCoexistAndRevokingOneLeavesTheOthers() {
    Ws ws = workspaceWithAllRoles();
    UUID account = createAccount(ws.admin(), ws.id(), "bot");
    UUID a = createKeyResp(ws.admin(), ws.id(), account, "A").uuid("/key/id");
    UUID b = createKeyResp(ws.admin(), ws.id(), account, "B").uuid("/key/id");
    String path = accountsPath(ws.id()) + "/" + account + "/api-keys/" + a;
    assertThat(delete(path, ws.admin().token()).status()).isEqualTo(204);
    // revoking again is harmless, and a revoked key stays revoked
    assertThat(delete(path, ws.admin().token()).status()).isEqualTo(204);
    Resp keys = get(accountsPath(ws.id()) + "/" + account + "/api-keys", ws.admin().token());
    for (var k : keys.json()) {
      assertThat(k.get("status").asText())
          .isEqualTo(k.get("id").asText().equals(a.toString()) ? "REVOKED" : "ACTIVE");
    }
    assertThat(
            jdbc.queryForObject(
                "SELECT revoked_at IS NULL FROM api_key WHERE id = ?", Boolean.class, b))
        .isTrue();
    assertThat(
            get(accountsPath(ws.id()) + "/" + account, ws.admin().token())
                .at("/activeKeys")
                .asInt())
        .isEqualTo(1);
  }

  @Test
  void anotherWorkspacesAccountOrKeyIs404() {
    Ws one = workspaceWithAllRoles();
    Ws two = workspaceWithAllRoles();
    Agent theirs = agent(two.admin(), two.id());
    String path = accountsPath(one.id()) + "/" + theirs.id();
    assertThat(get(path, one.admin().token()).status()).isEqualTo(404);
    assertThat(patch(path, one.admin().token(), Map.of("name", "x")).status()).isEqualTo(404);
    assertThat(post(path + "/disable", one.admin().token(), null).status()).isEqualTo(404);
    assertThat(get(path + "/api-keys", one.admin().token()).status()).isEqualTo(404);
    assertThat(createKeyResp(one.admin(), one.id(), theirs.id(), "x").status()).isEqualTo(404);
    // a key id under the wrong (own) account
    UUID mine = createAccount(one.admin(), one.id(), "mine");
    assertThat(
            delete(
                    accountsPath(one.id()) + "/" + mine + "/api-keys/" + theirs.keyId(),
                    one.admin().token())
                .status())
        .isEqualTo(404);
    // an admin of workspace two cannot reach workspace one's path
    assertThat(get(accountsPath(one.id()), two.admin().token()).status()).isEqualTo(404);
  }

  @Test
  void renameDisableAndEnableWork() {
    Ws ws = workspaceWithAllRoles();
    UUID account = createAccount(ws.admin(), ws.id(), "bot");
    String path = accountsPath(ws.id()) + "/" + account;
    assertThat(patch(path, ws.admin().token(), Map.of("name", "renamed")).text("/name"))
        .isEqualTo("renamed");
    assertThat(
            jdbc.queryForObject(
                "SELECT display_name FROM app_user WHERE id = ?", String.class, account))
        .isEqualTo("renamed");
    assertThat(post(path + "/disable", ws.admin().token(), null).at("/disabled").asBoolean())
        .isTrue();
    assertThat(post(path + "/enable", ws.admin().token(), null).at("/disabled").asBoolean())
        .isFalse();
    assertThat(
            jdbc.queryForList(
                "SELECT type FROM activity_event WHERE entity_id = ? ORDER BY created_at, id",
                String.class,
                account))
        .containsExactly(
            "service_account.created",
            "service_account.renamed",
            "service_account.disabled",
            "service_account.enabled");
  }
}
