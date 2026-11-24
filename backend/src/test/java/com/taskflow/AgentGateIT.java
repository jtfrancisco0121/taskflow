package com.taskflow;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.identity.internal.ServiceAccountTestBase;
import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.spec.McpSchema;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.web.server.LocalServerPort;

/**
 * Gate 2: an MCP client that knows only a URL and a key creates, updates, moves, comments on and
 * deletes a ticket, and the activity log names the service account.
 */
@DisplayName("Gate 2 an agent works a ticket over MCP with only a URL and a key")
class AgentGateIT extends ServiceAccountTestBase {

  @LocalServerPort int port;

  private McpSyncClient client(String key) {
    HttpClientStreamableHttpTransport transport =
        HttpClientStreamableHttpTransport.builder("http://localhost:" + port)
            .endpoint("/api/v1/mcp")
            .customizeRequest(request -> request.header("Authorization", "Bearer " + key))
            .build();
    return McpClient.sync(transport).requestTimeout(Duration.ofSeconds(20)).build();
  }

  private JsonNode tool(McpSyncClient client, String name, Map<String, Object> args)
      throws Exception {
    McpSchema.CallToolResult result = client.callTool(new McpSchema.CallToolRequest(name, args));
    String text = ((McpSchema.TextContent) result.content().get(0)).text();
    assertThat(result.isError()).as(name + ": " + text).isNotEqualTo(Boolean.TRUE);
    return mapper.readTree(text);
  }

  @Test
  void anAgentCreatesUpdatesMovesCommentsAndDeletesATicketAndTheLogNamesIt() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Engineering");
    UUID backlog = list(ws.owner(), space, "Backlog");
    UUID doing = list(ws.owner(), space, "Doing");
    Agent agent = agent(ws.admin(), ws.id(), "triage-agent", "CI-1");

    UUID task;
    try (McpSyncClient client = client(agent.secret())) {
      McpSchema.InitializeResult init = client.initialize();
      assertThat(init.serverInfo().name()).isEqualTo("taskflow");
      List<String> names = new ArrayList<>();
      client.listTools().tools().forEach(t -> names.add(t.name()));
      assertThat(names)
          .contains("create_task", "update_task", "move_task", "add_comment", "delete_task");
      assertThat(names)
          .hasSize(12)
          .contains("list_custom_fields", "add_dependency", "remove_dependency");

      JsonNode created =
          tool(client, "create_task", Map.of("listId", backlog.toString(), "title", "Fix login"));
      task = UUID.fromString(created.get("id").asText());
      JsonNode updated =
          tool(
              client,
              "update_task",
              Map.of(
                  "taskId",
                  task.toString(),
                  "version",
                  created.get("version").asLong(),
                  "title",
                  "Fix login redirect"));
      JsonNode moved =
          tool(
              client,
              "move_task",
              Map.of(
                  "taskId",
                  task.toString(),
                  "version",
                  updated.get("version").asLong(),
                  "listId",
                  doing.toString()));
      assertThat(moved.get("listId").asText()).isEqualTo(doing.toString());
      tool(client, "add_comment", Map.of("taskId", task.toString(), "text", "Reproduced; fixing."));

      // the person sees it all, named, before the agent deletes it
      List<JsonNode> before = activity(ws, task);
      assertThat(before.stream().map(n -> n.get("type").asText()).toList())
          .containsExactly("comment.created", "task.moved", "task.updated", "task.created");
      assertEveryEntryNamesTheAgent(before, agent);

      tool(client, "delete_task", Map.of("taskId", task.toString()));
    }
    assertThat(get("/api/v1/tasks/" + task, ws.admin().token()).status()).isEqualTo(404);

    // the delete is in the account's own log, with the same attribution
    Resp log = get(accountsPath(ws.id()) + "/" + agent.id() + "/activity", ws.admin().token());
    assertThat(log.status()).isEqualTo(200);
    List<String> types = new ArrayList<>();
    log.at("/items").forEach(n -> types.add(n.get("type").asText()));
    assertThat(types)
        .containsExactly(
            "task.trashed", "comment.created", "task.moved", "task.updated", "task.created");
    log.at("/items")
        .forEach(n -> {
          assertThat(n.get("actorKeyName").asText()).isEqualTo("CI-1");
          assertThat(n.get("actorKeyId").asText()).isEqualTo(agent.keyId().toString());
        });

    // and the delete is also on the task's own timeline once the task is restored
    long version = jdbc.queryForObject("SELECT version FROM task WHERE id = ?", Long.class, task);
    assertThat(
            post(
                    "/api/v1/tasks/" + task + "/restore",
                    ws.admin().token(),
                    null,
                    "If-Match",
                    "\"" + version + "\"")
                .status())
        .isEqualTo(200);
    List<JsonNode> after = activity(ws, task);
    JsonNode trashed =
        after.stream()
            .filter(n -> n.get("type").asText().equals("task.trashed"))
            .findFirst()
            .orElseThrow();
    assertThat(trashed.get("actorType").asText()).isEqualTo("SERVICE_ACCOUNT");
    assertThat(trashed.get("actorName").asText()).isEqualTo("triage-agent");
    assertThat(trashed.get("actorKeyName").asText()).isEqualTo("CI-1");

    // SM-3: the secret is in no event
    for (String table : new String[] {"activity_event", "outbox_event"}) {
      assertThat(
              jdbc.queryForObject(
                  "SELECT count(*) FROM " + table + " WHERE payload::text LIKE ?",
                  Integer.class,
                  "%" + agent.secret() + "%"))
          .as(table)
          .isZero();
    }
    // the usage was recorded for the whole session
    assertThat(
            jdbc.queryForObject(
                "SELECT sum(calls) FROM api_key_usage_daily WHERE api_key_id = ?",
                Long.class,
                agent.keyId()))
        .isGreaterThanOrEqualTo(8L);
  }

  private List<JsonNode> activity(Ws ws, UUID task) {
    Resp r = get("/api/v1/tasks/" + task + "/activity", ws.admin().token());
    assertThat(r.status()).isEqualTo(200);
    List<JsonNode> items = new ArrayList<>();
    r.at("/items").forEach(items::add);
    return items;
  }

  private void assertEveryEntryNamesTheAgent(List<JsonNode> entries, Agent agent) {
    for (JsonNode entry : entries) {
      assertThat(entry.get("actorType").asText()).isEqualTo("SERVICE_ACCOUNT");
      assertThat(entry.get("actorId").asText()).isEqualTo(agent.id().toString());
      assertThat(entry.get("actorName").asText()).isEqualTo("triage-agent");
      assertThat(entry.get("actorKeyName").asText()).isEqualTo("CI-1");
    }
  }
}
