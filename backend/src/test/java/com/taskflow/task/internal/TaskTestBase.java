package com.taskflow.task.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.IntegrationTest;
import java.util.Map;
import java.util.UUID;

/** Shared fixtures for the task integration tests. */
abstract class TaskTestBase extends IntegrationTest {

  record Fix(Ws ws, UUID space, UUID list) {}

  protected Fix fixture() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    return new Fix(ws, space, list(ws.member(), space, "L"));
  }

  protected UUID subtask(TestUser user, UUID list, UUID parent, String title) {
    Resp r =
        post(
            "/api/v1/lists/" + list + "/tasks",
            user.token(),
            Map.of("title", title, "parentTaskId", parent));
    if (r.status() != 201) {
      throw new IllegalStateException("subtask failed: " + r.status() + " " + r.raw());
    }
    return r.uuid("/id");
  }

  protected long version(TestUser user, UUID task) {
    return get("/api/v1/tasks/" + task, user.token()).at("/version").asLong();
  }

  protected JsonNode read(TestUser user, UUID task) {
    return get("/api/v1/tasks/" + task, user.token()).json();
  }

  protected Resp move(TestUser user, UUID task, long version, Map<String, Object> body) {
    return post(
        "/api/v1/tasks/" + task + "/move", user.token(), body, "If-Match", "\"" + version + "\"");
  }

  protected Resp trash(TestUser user, UUID task, long version) {
    return delete("/api/v1/tasks/" + task, user.token(), "If-Match", "\"" + version + "\"");
  }

  protected Resp restore(TestUser user, UUID task, long version) {
    return post(
        "/api/v1/tasks/" + task + "/restore",
        user.token(),
        null,
        "If-Match",
        "\"" + version + "\"");
  }

  protected int events(UUID entity, String type) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM outbox_event WHERE entity_id = ? AND type = ?",
        Integer.class,
        entity,
        type);
  }

  protected UUID statusId(UUID location, String name) {
    return jdbc.queryForObject(
        "SELECT id FROM status WHERE location_id = ? AND name = ? AND retired_at IS NULL",
        UUID.class,
        location,
        name);
  }
}
