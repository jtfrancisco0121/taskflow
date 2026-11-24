package com.taskflow.identity.internal;

import com.taskflow.IntegrationTest;
import java.util.Map;
import java.util.UUID;

/** Shared helpers for the service account and API key integration tests. */
public abstract class ServiceAccountTestBase extends IntegrationTest {

  public record Agent(UUID id, UUID keyId, String secret) {}

  protected String accountsPath(UUID workspaceId) {
    return "/api/v1/workspaces/" + workspaceId + "/service-accounts";
  }

  protected UUID createAccount(TestUser admin, UUID workspaceId, String name) {
    Resp r = post(accountsPath(workspaceId), admin.token(), Map.of("name", name));
    if (r.status() != 201) {
      throw new IllegalStateException("service account failed: " + r.status() + " " + r.raw());
    }
    return r.uuid("/id");
  }

  protected Resp createKeyResp(TestUser admin, UUID workspaceId, UUID accountId, String name) {
    return post(
        accountsPath(workspaceId) + "/" + accountId + "/api-keys",
        admin.token(),
        Map.of("name", name));
  }

  /** A service account with one key, created through the management API. */
  protected Agent agent(TestUser admin, UUID workspaceId, String accountName, String keyName) {
    UUID account = createAccount(admin, workspaceId, accountName);
    Resp r = createKeyResp(admin, workspaceId, account, keyName);
    if (r.status() != 201) {
      throw new IllegalStateException("api key failed: " + r.status() + " " + r.raw());
    }
    return new Agent(account, r.uuid("/key/id"), r.text("/secret"));
  }

  protected Agent agent(TestUser admin, UUID workspaceId) {
    return agent(admin, workspaceId, "agent-" + UUID.randomUUID().toString().substring(0, 8), "k1");
  }
}
