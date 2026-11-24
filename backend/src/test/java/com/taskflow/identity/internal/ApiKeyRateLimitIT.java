package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.shared.Hashing;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.TestPropertySource;

@DisplayName("KEY-5 per-key per-minute rate limit and KEY-6 usage")
@TestPropertySource(properties = "taskflow.api-keys.rate-limit.plans.default=5")
class ApiKeyRateLimitIT extends ServiceAccountTestBase {

  @Autowired StringRedisTemplate redis;

  private Resp call(String key) {
    return get("/api/v1/workspaces", key);
  }

  private static long header(Resp r, String name) {
    return Long.parseLong(r.headers().getFirst(name));
  }

  @Test
  void everyAcceptedResponseCarriesTheHeadersAndRemainingCountsDown() {
    Ws ws = workspaceWithAllRoles();
    Agent agent = agent(ws.admin(), ws.id());
    for (int i = 1; i <= 5; i++) {
      Resp r = call(agent.secret());
      assertThat(r.status()).isEqualTo(200);
      assertThat(header(r, "X-RateLimit-Limit")).isEqualTo(5);
      assertThat(header(r, "X-RateLimit-Remaining")).isEqualTo(5 - i);
      assertThat(header(r, "X-RateLimit-Reset"))
          .isGreaterThan(System.currentTimeMillis() / 1000 - 1);
    }
  }

  @Test
  void errorResponsesAndTheRefusalCarryTheHeadersAndRetryAfterMatchesReset() {
    Ws ws = workspaceWithAllRoles();
    Agent agent = agent(ws.admin(), ws.id());
    Resp notFound = get("/api/v1/tasks/" + UUID.randomUUID(), agent.secret());
    assertThat(notFound.status()).isEqualTo(404);
    assertThat(header(notFound, "X-RateLimit-Remaining")).isEqualTo(4);
    for (int i = 0; i < 4; i++) {
      assertThat(call(agent.secret()).status()).isEqualTo(200);
    }
    Resp refused = call(agent.secret());
    assertThat(refused.status()).isEqualTo(429);
    assertThat(refused.text("/code")).isEqualTo("rate_limit.exceeded");
    assertThat(refused.headers().getContentType().toString()).contains("problem+json");
    assertThat(header(refused, "X-RateLimit-Remaining")).isZero();
    long retryAfter = header(refused, "Retry-After");
    long reset = header(refused, "X-RateLimit-Reset");
    assertThat(retryAfter).isBetween(1L, 60L);
    assertThat(Math.abs(System.currentTimeMillis() / 1000 + retryAfter - reset))
        .isLessThanOrEqualTo(1);
  }

  @Test
  void aSecondKeyIsUnaffectedAndTheNextWindowSucceeds() {
    Ws ws = workspaceWithAllRoles();
    Agent a = agent(ws.admin(), ws.id());
    String b = createKeyResp(ws.admin(), ws.id(), a.id(), "B").text("/secret");
    Resp last = null;
    for (int i = 0; i < 6; i++) {
      last = call(a.secret());
    }
    assertThat(last.status()).isEqualTo(429);
    assertThat(call(b).status()).isEqualTo(200);
    // the window ends: its counter expires
    long minute = header(last, "X-RateLimit-Reset") / 60 - 1;
    redis.delete("rl:apikey:" + a.keyId() + ":" + minute);
    Resp next = call(a.secret());
    assertThat(next.status()).isEqualTo(200);
    assertThat(header(next, "X-RateLimit-Remaining")).isEqualTo(4);
  }

  @Test
  void manyFailedCallsFromOneIpNeverBlockAValidKeyAndTheRevokedKeyStays401() {
    Ws ws = workspaceWithAllRoles();
    Agent valid = agent(ws.admin(), ws.id());
    Agent revoked = agent(ws.admin(), ws.id());
    delete(
        accountsPath(ws.id()) + "/" + revoked.id() + "/api-keys/" + revoked.keyId(),
        ws.admin().token());
    for (int i = 0; i < 100; i++) {
      Resp r = call(revoked.secret());
      assertThat(r.status()).as("call " + i).isEqualTo(401);
      assertThat(r.headers().getFirst("X-RateLimit-Limit")).isNull();
    }
    assertThat(call(valid.secret()).status()).isEqualTo(200);
    assertThat(call(revoked.secret()).status()).isEqualTo(401);
    // the failed hash is answered from the negative cache, not Postgres
    assertThat(redis.hasKey("apikey-neg:" + Hashing.sha256Hex(revoked.secret()))).isTrue();
  }

  @Test
  void aMalformedKeyIs401WithoutTouchingTheNegativeCache() {
    Resp r = call("tf_sk_nope");
    assertThat(r.status()).isEqualTo(401);
    assertThat(r.text("/code")).isEqualTo("auth.invalid_api_key");
    assertThat(redis.hasKey("apikey-neg:" + Hashing.sha256Hex("tf_sk_nope"))).isFalse();
  }

  @Test
  void disableCallEnableCallSucceedsAtOnce() {
    Ws ws = workspaceWithAllRoles();
    Agent agent = agent(ws.admin(), ws.id());
    String path = accountsPath(ws.id()) + "/" + agent.id();
    post(path + "/disable", ws.admin().token(), null);
    assertThat(call(agent.secret()).status()).isEqualTo(401);
    assertThat(redis.hasKey("apikey-neg:" + Hashing.sha256Hex(agent.secret()))).isTrue();
    post(path + "/enable", ws.admin().token(), null);
    assertThat(redis.hasKey("apikey-neg:" + Hashing.sha256Hex(agent.secret()))).isFalse();
    assertThat(call(agent.secret()).status()).isEqualTo(200);
  }

  @Test
  void theUsageRowEqualsTheAdmittedCallsAndLastUsedIsSet() {
    Ws ws = workspaceWithAllRoles();
    Agent agent = agent(ws.admin(), ws.id());
    for (int i = 0; i < 7; i++) {
      call(agent.secret());
    }
    // 5 admitted, 2 refused
    assertThat(
            jdbc.queryForObject(
                "SELECT calls FROM api_key_usage_daily WHERE api_key_id = ? AND day = (now() AT TIME"
                    + " ZONE 'UTC')::date",
                Long.class,
                agent.keyId()))
        .isEqualTo(5L);
    assertThat(
            jdbc.queryForObject(
                "SELECT last_used_at IS NOT NULL FROM api_key WHERE id = ?",
                Boolean.class,
                agent.keyId()))
        .isTrue();
  }
}
