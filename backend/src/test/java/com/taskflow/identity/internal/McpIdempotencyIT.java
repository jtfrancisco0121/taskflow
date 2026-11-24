package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import org.junit.jupiter.api.Test;

/** An idempotency key on the MCP create tools (decision 005.11). */
class McpIdempotencyIT extends McpTestBase {

  @Test
  void aRetryWithTheSameKeyCreatesOneTaskAndReturnsTheSameResult() {
    Setup s = setup();
    Map<String, Object> args = createArgs(s.list(), "Fix login", "k-" + UUID.randomUUID());

    ToolResult first = call(s.agent().secret(), "create_task", args);
    ToolResult retry = call(s.agent().secret(), "create_task", args);

    assertThat(first.isError()).as(first.body().toString()).isFalse();
    assertThat(retry.isError()).as(retry.body().toString()).isFalse();
    assertThat(retry.body().get("id")).isEqualTo(first.body().get("id"));
    assertThat(retry.body()).isEqualTo(first.body());
    assertThat(tasksIn(s.list())).isEqualTo(1);
  }

  @Test
  void differentKeysCreateTwoTasks() {
    Setup s = setup();

    ToolResult a = call(s.agent().secret(), "create_task", createArgs(s.list(), "A", "k-a"));
    ToolResult b = call(s.agent().secret(), "create_task", createArgs(s.list(), "A", "k-b"));

    assertThat(a.body().get("id")).isNotEqualTo(b.body().get("id"));
    assertThat(tasksIn(s.list())).isEqualTo(2);
  }

  @Test
  void theSameKeyWithADifferentPayloadIsRefused() {
    Setup s = setup();
    String key = "k-" + UUID.randomUUID();
    call(s.agent().secret(), "create_task", createArgs(s.list(), "Fix login", key));

    ToolResult other = call(s.agent().secret(), "create_task", createArgs(s.list(), "Other", key));

    assertThat(other.isError()).isTrue();
    assertThat(other.body().get("code").asText()).isEqualTo("idempotency.key_reused");
    assertThat(tasksIn(s.list())).isEqualTo(1);
  }

  @Test
  void argumentOrderDoesNotChangeTheRequest() {
    Setup s = setup();
    String key = "k-" + UUID.randomUUID();
    Map<String, Object> ordered = new java.util.LinkedHashMap<>();
    ordered.put("listId", s.list().toString());
    ordered.put("title", "Fix login");
    ordered.put("tags", List.of("bug"));
    ordered.put("idempotencyKey", key);
    Map<String, Object> reversed = new java.util.LinkedHashMap<>();
    reversed.put("idempotencyKey", key);
    reversed.put("tags", List.of("bug"));
    reversed.put("title", "Fix login");
    reversed.put("listId", s.list().toString());

    ToolResult a = call(s.agent().secret(), "create_task", ordered);
    ToolResult b = call(s.agent().secret(), "create_task", reversed);

    assertThat(b.isError()).as(b.body().toString()).isFalse();
    assertThat(b.body().get("id")).isEqualTo(a.body().get("id"));
    assertThat(tasksIn(s.list())).isEqualTo(1);
  }

  @Test
  void twoConcurrentCallsWithTheSameKeyCreateExactlyOneTask() throws Exception {
    Setup s = setup();
    Map<String, Object> args = createArgs(s.list(), "Race", "k-" + UUID.randomUUID());
    CountDownLatch start = new CountDownLatch(1);
    List<CompletableFuture<ToolResult>> calls = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      calls.add(
          CompletableFuture.supplyAsync(() -> {
            try {
              start.await();
            } catch (InterruptedException e) {
              throw new IllegalStateException(e);
            }
            return call(s.agent().secret(), "create_task", args);
          }));
    }
    start.countDown();

    List<JsonNode> ids = new ArrayList<>();
    for (CompletableFuture<ToolResult> c : calls) {
      ToolResult r = c.get();
      if (r.isError()) {
        assertThat(r.body().get("code").asText()).isEqualTo("idempotency.in_progress");
      } else {
        ids.add(r.body().get("id"));
      }
    }
    assertThat(tasksIn(s.list())).isEqualTo(1);
    assertThat(ids).isNotEmpty().allMatch(id -> id.equals(ids.get(0)));
  }

  @Test
  void keysAreScopedPerServiceAccount() {
    Setup s = setup();
    Agent other = agent(s.ws().admin(), s.ws().id(), "second-agent", "K2");
    String key = "shared-key";

    ToolResult a = call(s.agent().secret(), "create_task", createArgs(s.list(), "Same", key));
    ToolResult b = call(other.secret(), "create_task", createArgs(s.list(), "Same", key));

    assertThat(b.isError()).as(b.body().toString()).isFalse();
    assertThat(b.body().get("id")).isNotEqualTo(a.body().get("id"));
    assertThat(tasksIn(s.list())).isEqualTo(2);
  }

  @Test
  void addCommentIsIdempotentToo() {
    Setup s = setup();
    ToolResult task =
        call(
            s.agent().secret(), "create_task", Map.of("listId", s.list().toString(), "title", "T"));
    UUID taskId = UUID.fromString(task.body().get("id").asText());
    Map<String, Object> args =
        Map.of("taskId", taskId.toString(), "text", "Looking into it", "idempotencyKey", "c-1");

    ToolResult first = call(s.agent().secret(), "add_comment", args);
    ToolResult retry = call(s.agent().secret(), "add_comment", args);

    assertThat(retry.body().get("id")).isEqualTo(first.body().get("id"));
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM comment WHERE task_id = ?", Integer.class, taskId))
        .isEqualTo(1);
  }

  @Test
  void withoutAKeyEachCallCreatesAsBefore() {
    Setup s = setup();
    Map<String, Object> args = Map.of("listId", s.list().toString(), "title", "No key");

    call(s.agent().secret(), "create_task", args);
    call(s.agent().secret(), "create_task", args);

    assertThat(tasksIn(s.list())).isEqualTo(2);
  }

  @Test
  void anInvalidKeyIsRefused() {
    Setup s = setup();
    Map<String, Object> args = new java.util.HashMap<>(createArgs(s.list(), "T", "x"));
    args.put("idempotencyKey", 42);

    ToolResult r = call(s.agent().secret(), "create_task", args);

    assertThat(r.isError()).isTrue();
    assertThat(r.body().get("code").asText()).isEqualTo("idempotency.invalid_key");
    assertThat(tasksIn(s.list())).isZero();
  }

  @Test
  void theCreateToolsAdvertiseTheKeyAndOthersDoNot() {
    Setup s = setup();
    for (JsonNode t : rpc(s.agent().secret(), "tools/list", null).at("/result/tools")) {
      String name = t.get("name").asText();
      boolean creates = name.equals("create_task") || name.equals("add_comment");
      assertThat(t.at("/inputSchema/properties/idempotencyKey").isMissingNode())
          .as(name)
          .isEqualTo(!creates);
      assertThat(t.get("description").asText().contains("idempotencyKey"))
          .as(name)
          .isEqualTo(creates);
    }
  }

  private record Setup(Ws ws, UUID list, Agent agent) {}

  private Setup setup() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Engineering");
    UUID list = list(ws.owner(), space, "Backlog");
    return new Setup(ws, list, agent(ws.admin(), ws.id()));
  }

  private static Map<String, Object> createArgs(UUID list, String title, String key) {
    return Map.of("listId", list.toString(), "title", title, "idempotencyKey", key);
  }

  private int tasksIn(UUID list) {
    return jdbc.queryForObject("SELECT count(*) FROM task WHERE list_id = ?", Integer.class, list);
  }
}
