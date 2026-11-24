package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("MCP-1 the MCP endpoint takes a service account key and nothing else")
class McpEndpointIT extends McpTestBase {

  private static final List<String> TOOLS =
      List.of(
          "add_comment",
          "add_dependency",
          "create_task",
          "delete_task",
          "get_task",
          "list_custom_fields",
          "list_locations",
          "list_views",
          "move_task",
          "remove_dependency",
          "search_tasks",
          "update_task");

  private static final Map<String, Object> INIT =
      Map.of(
          "protocolVersion",
          "2025-06-18",
          "capabilities",
          Map.of(),
          "clientInfo",
          Map.of("name", "test", "version", "1"));

  @Test
  void withoutAKeyIs401AndWithAJwtIs403() {
    Ws ws = workspaceWithAllRoles();
    Resp none = rpc(null, "tools/list", null);
    assertThat(none.status()).isEqualTo(401);
    Resp jwt = rpc(ws.admin().token(), "tools/list", null);
    assertThat(jwt.status()).isEqualTo(403);
    assertThat(jwt.text("/code")).isEqualTo("auth.forbidden");
    Resp bad = rpc("tf_sk_" + com.taskflow.shared.Hashing.newToken(), "tools/list", null);
    assertThat(bad.status()).isEqualTo(401);
    assertThat(bad.text("/code")).isEqualTo("auth.invalid_api_key");
  }

  @Test
  void initializeAndListToolsReturnExactlyTheTwelveTools() {
    Ws ws = workspaceWithAllRoles();
    Agent agent = agent(ws.admin(), ws.id());
    for (String key : new String[] {agent.secret()}) {
      Resp init = rpc(key, "initialize", INIT);
      assertThat(init.status()).isEqualTo(200);
      assertThat(init.text("/result/serverInfo/name")).isEqualTo("taskflow");
      assertThat(init.at("/result/capabilities/tools").isMissingNode()).isFalse();
    }
    // the raw key works as well as Bearer
    Resp raw =
        post(
            MCP,
            null,
            Map.of("jsonrpc", "2.0", "id", 2, "method", "tools/list"),
            "Authorization",
            agent.secret(),
            "Accept",
            "application/json, text/event-stream");
    assertThat(raw.status()).isEqualTo(200);
    List<String> names = new ArrayList<>();
    for (JsonNode t : rpc(agent.secret(), "tools/list", null).at("/result/tools")) {
      names.add(t.get("name").asText());
      assertThat(t.get("description").asText()).isNotBlank();
      assertThat(t.at("/inputSchema/type").asText()).isEqualTo("object");
    }
    assertThat(names).containsExactlyInAnyOrderElementsOf(TOOLS).hasSize(12);
  }

  @Test
  void aRevokedKeyIsRefusedOnTheMcpEndpointToo() {
    Ws ws = workspaceWithAllRoles();
    Agent agent = agent(ws.admin(), ws.id());
    assertThat(rpc(agent.secret(), "tools/list", null).status()).isEqualTo(200);
    delete(
        accountsPath(ws.id()) + "/" + agent.id() + "/api-keys/" + agent.keyId(),
        ws.admin().token());
    assertThat(rpc(agent.secret(), "tools/list", null).status()).isEqualTo(401);
  }
}
