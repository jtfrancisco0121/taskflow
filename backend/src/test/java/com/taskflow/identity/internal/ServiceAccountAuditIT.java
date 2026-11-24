package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("KEY-6 audit view and CMT-2 attribution")
class ServiceAccountAuditIT extends ServiceAccountTestBase {

  private String auditPath(Ws ws, Agent agent) {
    return accountsPath(ws.id()) + "/" + agent.id() + "/audit";
  }

  private String activityPath(Ws ws, Agent agent) {
    return accountsPath(ws.id()) + "/" + agent.id() + "/activity";
  }

  @Test
  void theAuditShows30ZeroFilledDaysTheCallsAndTheLastUsedTime() {
    Ws ws = workspaceWithAllRoles();
    Agent agent = agent(ws.admin(), ws.id(), "bot", "CI-1");
    Resp before = get(auditPath(ws, agent), ws.admin().token());
    assertThat(before.status()).isEqualTo(200);
    assertThat(before.at("/days")).hasSize(30);
    assertThat(before.at("/totalCalls").asLong()).isZero();
    assertThat(before.at("/keys/0/lastUsedAt").isNull()).isTrue();

    int calls = 7;
    for (int i = 0; i < calls; i++) {
      assertThat(get("/api/v1/workspaces", agent.secret()).status()).isEqualTo(200);
    }
    Resp audit = get(auditPath(ws, agent), ws.admin().token());
    JsonNode today = audit.at("/days/29");
    assertThat(today.get("day").asText()).isEqualTo(LocalDate.now(ZoneOffset.UTC).toString());
    assertThat(today.get("calls").asLong()).isEqualTo(calls);
    assertThat(audit.at("/days/0/calls").asLong()).isZero();
    assertThat(audit.at("/totalCalls").asLong()).isEqualTo(calls);
    assertThat(audit.text("/keys/0/name")).isEqualTo("CI-1");
    assertThat(audit.at("/keys/0/calls").asLong()).isEqualTo(calls);
    assertThat(audit.at("/keys/0/lastUsedAt").isNull()).isFalse();
  }

  @Test
  void activityPagesNewestFirstWithAKeysetCursor() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.owner(), space, "L");
    Agent agent = agent(ws.admin(), ws.id(), "bot", "CI-1");
    List<String> created = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      Resp r = post("/api/v1/lists/" + list + "/tasks", agent.secret(), Map.of("title", "T" + i));
      assertThat(r.status()).isEqualTo(201);
      created.add(0, r.text("/id"));
    }
    List<String> titles = new ArrayList<>();
    String cursor = null;
    int pages = 0;
    do {
      Resp r =
          get(
              activityPath(ws, agent) + "?limit=2" + (cursor == null ? "" : "&cursor=" + cursor),
              ws.admin().token());
      assertThat(r.status()).isEqualTo(200);
      r.at("/items").forEach(n -> titles.add(n.get("entityId").asText()));
      cursor = r.at("/nextCursor").isNull() ? null : r.text("/nextCursor");
      pages++;
    } while (cursor != null);
    assertThat(pages).isEqualTo(3);
    assertThat(titles).containsExactlyElementsOf(created);
    Resp first = get(activityPath(ws, agent) + "?limit=1", ws.admin().token());
    assertThat(first.text("/items/0/actorKeyName")).isEqualTo("CI-1");
    assertThat(first.text("/items/0/actorKeyId")).isEqualTo(agent.keyId().toString());
    // the human owner's own changes are not the agent's
    assertThat(get(activityPath(ws, agent), ws.admin().token()).at("/items")).hasSize(5);
  }

  @Test
  void aNonTaskChangeAndATrashedTaskComeBackWithTheirEntityAndVersion() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.owner(), space, "L");
    UUID task = task(ws.owner(), list, "Doomed");
    Agent agent = agent(ws.admin(), ws.id(), "bot", "CI-1");
    assertThat(
            patch("/api/v1/locations/" + list, agent.secret(), Map.of("name", "Renamed")).status())
        .isEqualTo(200);
    assertThat(delete("/api/v1/tasks/" + task, agent.secret(), "If-Match", "\"1\"").status())
        .isEqualTo(204);

    Resp r = get(activityPath(ws, agent), ws.admin().token());
    assertThat(r.at("/items")).hasSize(2);
    JsonNode trashed = r.at("/items/0");
    assertThat(trashed.get("entity").asText()).isEqualTo("task");
    assertThat(trashed.get("entityId").asText()).isEqualTo(task.toString());
    assertThat(trashed.get("type").asText()).isEqualTo("task.trashed");
    long version = trashed.at("/payload/version").asLong();
    // the payload version is the one POST /tasks/{id}/restore wants in If-Match
    assertThat(
            post(
                    "/api/v1/tasks/" + task + "/restore",
                    ws.admin().token(),
                    null,
                    "If-Match",
                    "\"" + version + "\"")
                .status())
        .isEqualTo(200);
    JsonNode renamed = r.at("/items/1");
    assertThat(renamed.get("entity").asText()).isEqualTo("location");
    assertThat(renamed.get("entityId").asText()).isEqualTo(list.toString());
  }

  @Test
  void membersGuestsAndKeysGet403() {
    Ws ws = workspaceWithAllRoles();
    Agent agent = agent(ws.admin(), ws.id());
    for (String role : new String[] {"MEMBER", "GUEST"}) {
      assertThat(get(auditPath(ws, agent), ws.by(role).token()).status()).isEqualTo(403);
      assertThat(get(activityPath(ws, agent), ws.by(role).token()).status()).isEqualTo(403);
    }
    assertThat(get(auditPath(ws, agent), agent.secret()).status()).isEqualTo(403);
    assertThat(get(activityPath(ws, agent), agent.secret()).status()).isEqualTo(403);
    Ws other = workspaceWithAllRoles();
    assertThat(get(auditPath(other, agent), other.admin().token()).status()).isEqualTo(404);
  }
}
