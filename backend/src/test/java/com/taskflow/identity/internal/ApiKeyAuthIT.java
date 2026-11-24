package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("KEY-3 API key authentication")
class ApiKeyAuthIT extends ServiceAccountTestBase {

  private Resp treeWithBearer(UUID ws, String key) {
    return get("/api/v1/workspaces/" + ws + "/tree", key);
  }

  private Resp treeRaw(UUID ws, String key) {
    return get("/api/v1/workspaces/" + ws + "/tree", null, "Authorization", key);
  }

  private void assertInvalid(Resp r, String key) {
    assertThat(r.status()).isEqualTo(401);
    assertThat(r.text("/code")).isEqualTo("auth.invalid_api_key");
    assertThat(r.raw()).doesNotContain(key);
  }

  @Test
  void bothHeaderFormsAuthenticateTheSameKey() {
    Ws ws = workspaceWithAllRoles();
    Agent agent = agent(ws.admin(), ws.id());
    Resp bearer = treeWithBearer(ws.id(), agent.secret());
    Resp raw = treeRaw(ws.id(), agent.secret());
    assertThat(bearer.status()).isEqualTo(200);
    assertThat(raw.status()).isEqualTo(200);
    assertThat(raw.json()).isEqualTo(bearer.json());
    // any other endpoint too
    assertThat(get("/api/v1/workspaces/" + ws.id(), agent.secret()).status()).isEqualTo(200);
  }

  @Test
  void unknownMalformedRevokedAndExpiredKeysAre401WithoutEchoingTheKey() {
    Ws ws = workspaceWithAllRoles();
    Agent agent = agent(ws.admin(), ws.id());
    String unknown = "tf_sk_" + com.taskflow.shared.Hashing.newToken();
    String malformed = "tf_sk_short";
    assertInvalid(treeWithBearer(ws.id(), unknown), unknown);
    assertInvalid(treeRaw(ws.id(), unknown), unknown);
    assertInvalid(treeWithBearer(ws.id(), malformed), malformed);

    Resp soon = createKeyResp(ws.admin(), ws.id(), agent.id(), "soon");
    UUID expired = soon.uuid("/key/id");
    String expiredSecret = soon.text("/secret");
    jdbc.update(
        "UPDATE api_key SET expires_at = now() - interval '1 minute' WHERE id = ?", expired);
    assertInvalid(treeWithBearer(ws.id(), expiredSecret), expiredSecret);

    assertThat(
            delete(
                    accountsPath(ws.id()) + "/" + agent.id() + "/api-keys/" + agent.keyId(),
                    ws.admin().token())
                .status())
        .isEqualTo(204);
    assertInvalid(treeWithBearer(ws.id(), agent.secret()), agent.secret());
  }

  @Test
  void disablingAnAccountStopsItsKeysAtOnceAndEnablingRestoresThem() {
    Ws ws = workspaceWithAllRoles();
    Agent agent = agent(ws.admin(), ws.id());
    assertThat(treeWithBearer(ws.id(), agent.secret()).status()).isEqualTo(200);
    String path = accountsPath(ws.id()) + "/" + agent.id();
    post(path + "/disable", ws.admin().token(), null);
    assertInvalid(treeWithBearer(ws.id(), agent.secret()), agent.secret());
    post(path + "/enable", ws.admin().token(), null);
    assertThat(treeWithBearer(ws.id(), agent.secret()).status()).isEqualTo(200);
  }

  @Test
  void revokingKeyAStopsAAndLeavesB() {
    Ws ws = workspaceWithAllRoles();
    Agent a = agent(ws.admin(), ws.id());
    Resp b = createKeyResp(ws.admin(), ws.id(), a.id(), "B");
    delete(accountsPath(ws.id()) + "/" + a.id() + "/api-keys/" + a.keyId(), ws.admin().token());
    assertInvalid(treeWithBearer(ws.id(), a.secret()), a.secret());
    assertThat(treeWithBearer(ws.id(), b.text("/secret")).status()).isEqualTo(200);
  }

  @Test
  void jwtCallsAreUnchangedAndABadJwtStaysUnauthenticated() {
    Ws ws = workspaceWithAllRoles();
    assertThat(treeWithBearer(ws.id(), ws.member().token()).status()).isEqualTo(200);
    Resp bad = treeWithBearer(ws.id(), "not.a.jwt");
    assertThat(bad.status()).isEqualTo(401);
    assertThat(bad.text("/code")).isEqualTo("auth.unauthenticated");
    assertThat(get("/api/v1/workspaces/" + ws.id() + "/tree", null).status()).isEqualTo(401);
  }

  @Test
  void aKeyCannotManageServiceAccountsOrKeys() {
    Ws ws = workspaceWithAllRoles();
    Agent agent = agent(ws.admin(), ws.id());
    String path = accountsPath(ws.id());
    String key = agent.secret();
    for (Resp r :
        new Resp[] {
          get(path, key),
          post(path, key, Map.of("name", "evil")),
          get(path + "/" + agent.id(), key),
          patch(path + "/" + agent.id(), key, Map.of("name", "evil")),
          post(path + "/" + agent.id() + "/disable", key, null),
          post(path + "/" + agent.id() + "/enable", key, null),
          get(path + "/" + agent.id() + "/api-keys", key),
          post(path + "/" + agent.id() + "/api-keys", key, Map.of("name", "evil")),
          delete(path + "/" + agent.id() + "/api-keys/" + agent.keyId(), key)
        }) {
      assertThat(r.status()).isEqualTo(403);
      assertThat(r.text("/code")).isEqualTo("auth.forbidden");
    }
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM service_account WHERE workspace_id = ?",
                Integer.class,
                ws.id()))
        .isEqualTo(1);
  }
}
