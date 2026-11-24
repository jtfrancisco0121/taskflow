package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.identity.internal.McpTestBase;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("MCP-2 the task tools do what REST does, as the service account")
class TaskAgentToolsIT extends McpTestBase {

  private record Fix(Ws ws, UUID space, UUID list, Agent agent) {}

  private Fix fixture() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.owner(), space, "L");
    return new Fix(ws, space, list, agent(ws.admin(), ws.id(), "triage-agent", "CI-1"));
  }

  private JsonNode rest(Fix f, String path) {
    Resp r = get(path, f.ws().admin().token());
    assertThat(r.status()).as(path).isEqualTo(200);
    return r.json();
  }

  @Test
  void createGetAndUpdateReturnTheRestTaskAndWriteAsTheServiceAccount() {
    Fix f = fixture();
    String key = f.agent().secret();
    ToolResult created =
        call(
            key,
            "create_task",
            Map.of(
                "listId",
                f.list().toString(),
                "title",
                "From an agent",
                "description",
                "line one\nline two",
                "priority",
                "HIGH"));
    assertThat(created.isError()).isFalse();
    UUID id = UUID.fromString(created.body().get("id").asText());
    assertThat(created.body()).isEqualTo(rest(f, "/api/v1/tasks/" + id));
    assertThat(created.body().at("/description/content")).hasSize(2);
    assertThat(created.body().at("/description/content/1/content/0/text").asText())
        .isEqualTo("line two");
    assertThat(created.body().get("createdBy").asText()).isEqualTo(f.agent().id().toString());

    assertThat(call(key, "get_task", Map.of("taskId", id.toString())).body())
        .isEqualTo(created.body());
    String ref = created.body().get("readableId").asText();
    assertThat(call(key, "get_task", Map.of("ref", ref)).body()).isEqualTo(created.body());
    assertThat(
            get(
                    "/api/v1/workspaces/" + f.ws().id() + "/tasks/by-ref/" + ref,
                    f.ws().admin().token())
                .json())
        .isEqualTo(created.body());

    ToolResult updated =
        call(
            key,
            "update_task",
            Map.of(
                "taskId",
                id.toString(),
                "version",
                1,
                "title",
                "Renamed by agent",
                "description",
                "new text"));
    assertThat(updated.isError()).isFalse();
    assertThat(updated.body().get("title").asText()).isEqualTo("Renamed by agent");
    assertThat(updated.body()).isEqualTo(rest(f, "/api/v1/tasks/" + id));

    // every write is attributed to the service account and the key
    assertThat(
            jdbc.queryForList(
                "SELECT actor_type || ':' || actor_id || ':' || actor_key_id FROM activity_event"
                    + " WHERE entity_id = ? ORDER BY created_at, id",
                String.class,
                id))
        .containsOnly("SERVICE_ACCOUNT:" + f.agent().id() + ":" + f.agent().keyId());
  }

  @Test
  void searchLocationsAndViewsEqualTheirRestEndpoints() {
    Fix f = fixture();
    String key = f.agent().secret();
    call(
        key, "create_task", Map.of("listId", f.list().toString(), "title", "Quarterly zebra plan"));
    ToolResult found = call(key, "search_tasks", Map.of("query", "zebra"));
    assertThat(found.body().at("/items")).hasSize(1);
    assertThat(found.body())
        .isEqualTo(rest(f, "/api/v1/workspaces/" + f.ws().id() + "/search?q=zebra"));

    assertThat(call(key, "list_locations", Map.of()).body())
        .isEqualTo(rest(f, "/api/v1/workspaces/" + f.ws().id() + "/tree"));
    assertThat(call(key, "list_locations", Map.of("parentId", f.space().toString())).body())
        .isEqualTo(rest(f, "/api/v1/workspaces/" + f.ws().id() + "/tree?parentId=" + f.space()));
    assertThat(call(key, "list_views", Map.of("locationId", f.list().toString())).body())
        .isEqualTo(rest(f, "/api/v1/locations/" + f.list() + "/views"));
  }

  @Test
  void moveAndCommentEqualTheirRestResults() {
    Fix f = fixture();
    String key = f.agent().secret();
    UUID other = list(f.ws().owner(), f.space(), "L2");
    UUID id =
        UUID.fromString(
            call(key, "create_task", Map.of("listId", f.list().toString(), "title", "Mover"))
                .body()
                .get("id")
                .asText());
    ToolResult moved =
        call(key, "move_task", Map.of("taskId", id.toString(), "listId", other.toString()));
    assertThat(moved.isError()).isFalse();
    assertThat(moved.body().get("listId").asText()).isEqualTo(other.toString());
    assertThat(moved.body()).isEqualTo(rest(f, "/api/v1/tasks/" + id));

    ToolResult comment =
        call(key, "add_comment", Map.of("taskId", id.toString(), "text", "looks good\nship it"));
    assertThat(comment.isError()).isFalse();
    assertThat(comment.body().get("authorId").asText()).isEqualTo(f.agent().id().toString());
    JsonNode listed = rest(f, "/api/v1/tasks/" + id + "/comments");
    assertThat(listed.at("/items/0")).isEqualTo(comment.body());
    assertThat(rest(f, "/api/v1/tasks/" + id + "/activity").at("/items/0/actorKeyName").asText())
        .isEqualTo("CI-1");
  }

  @Test
  void deleteTaskTrashesAndAPersonCanRestoreIt() {
    Fix f = fixture();
    String key = f.agent().secret();
    UUID id =
        UUID.fromString(
            call(key, "create_task", Map.of("listId", f.list().toString(), "title", "Doomed"))
                .body()
                .get("id")
                .asText());
    ToolResult deleted = call(key, "delete_task", Map.of("taskId", id.toString()));
    assertThat(deleted.isError()).isFalse();
    assertThat(deleted.body().get("trashed").asBoolean()).isTrue();
    assertThat(get("/api/v1/tasks/" + id, f.ws().admin().token()).status()).isEqualTo(404);
    JsonNode trash = rest(f, "/api/v1/workspaces/" + f.ws().id() + "/trash");
    assertThat(trash.toString()).contains(id.toString());
    long trashedVersion =
        jdbc.queryForObject("SELECT version FROM task WHERE id = ?", Long.class, id);
    Resp restored =
        post(
            "/api/v1/tasks/" + id + "/restore",
            f.ws().admin().token(),
            null,
            "If-Match",
            "\"" + trashedVersion + "\"");
    assertThat(restored.status()).isEqualTo(200);
    assertThat(get("/api/v1/tasks/" + id, f.ws().admin().token()).status()).isEqualTo(200);
  }

  @Test
  void restErrorsSurfaceAsToolErrorsWithTheSameCode() {
    Fix f = fixture();
    String key = f.agent().secret();
    // 404
    UUID missing = UUID.randomUUID();
    Resp rest404 = get("/api/v1/tasks/" + missing, f.ws().admin().token());
    ToolResult notFound = call(key, "get_task", Map.of("taskId", missing.toString()));
    assertThat(rest404.status()).isEqualTo(404);
    assertThat(notFound.isError()).isTrue();
    assertThat(notFound.body().get("code").asText()).isEqualTo(rest404.text("/code"));
    assertThat(notFound.body().get("status").asInt()).isEqualTo(404);

    // another Workspace's task is a 404 too
    Ws other = workspaceWithAllRoles();
    UUID foreign =
        task(other.owner(), list(other.owner(), space(other.owner(), other.id(), "X"), "L"), "T");
    assertThat(
            call(key, "get_task", Map.of("taskId", foreign.toString())).body().get("code").asText())
        .isEqualTo("task.not_found");

    // 409 with the current task
    UUID id =
        UUID.fromString(
            call(key, "create_task", Map.of("listId", f.list().toString(), "title", "Race"))
                .body()
                .get("id")
                .asText());
    call(key, "update_task", Map.of("taskId", id.toString(), "version", 1, "title", "v2"));
    ToolResult stale =
        call(key, "update_task", Map.of("taskId", id.toString(), "version", 1, "title", "stale"));
    Resp restStale = patchTask(f.ws().admin(), id, 1, Map.of("title", "stale"));
    assertThat(restStale.status()).isEqualTo(409);
    assertThat(stale.isError()).isTrue();
    assertThat(stale.body().get("code").asText()).isEqualTo(restStale.text("/code"));
    assertThat(stale.body().get("status").asInt()).isEqualTo(409);
    assertThat(stale.body().at("/current/version").asLong()).isEqualTo(2);
    assertThat(stale.body().at("/current/title").asText()).isEqualTo("v2");

    // 400: validation
    ToolResult invalid =
        call(key, "create_task", Map.of("listId", f.list().toString(), "title", " "));
    assertThat(invalid.isError()).isTrue();
    assertThat(invalid.body().get("status").asInt()).isEqualTo(400);
    ToolResult noList = call(key, "create_task", Map.of("title", "x"));
    assertThat(noList.body().get("code").asText()).isEqualTo("tool.invalid_argument");
  }
}
