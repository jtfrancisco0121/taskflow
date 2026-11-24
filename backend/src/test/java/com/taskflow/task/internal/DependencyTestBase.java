package com.taskflow.task.internal;

import java.util.Map;
import java.util.UUID;

/** Fixtures for the relationship tests: add, remove and complete tasks by id. */
abstract class DependencyTestBase extends TaskTestBase {

  /** Adds a relationship from {@code task}'s side, reading its current version. */
  protected Resp relate(TestUser user, UUID task, String relation, UUID other) {
    return post(
        "/api/v1/tasks/" + task + "/dependencies",
        user.token(),
        Map.of("otherTaskId", other, "relation", relation),
        "If-Match",
        "\"" + version(user, task) + "\"");
  }

  protected Resp unrelate(TestUser user, UUID task, UUID dependencyId) {
    return delete(
        "/api/v1/tasks/" + task + "/dependencies/" + dependencyId,
        user.token(),
        "If-Match",
        "\"" + version(user, task) + "\"");
  }

  protected Resp dependencies(TestUser user, UUID task) {
    return get("/api/v1/tasks/" + task + "/dependencies", user.token());
  }

  /** Sets a status by name of the Space's default set, reading the current version. */
  protected Resp setStatus(TestUser user, UUID space, UUID task, String statusName) {
    return patchTask(
        user, task, version(user, task), Map.of("statusId", statusId(space, statusName)));
  }

  protected boolean blocked(TestUser user, UUID task) {
    return read(user, task).get("blocked").asBoolean();
  }

  protected int blockerCount(TestUser user, UUID task) {
    return read(user, task).get("blockerCount").asInt();
  }

  protected int count(String table, UUID workspace) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM " + table + " WHERE workspace_id = ?", Integer.class, workspace);
  }

  protected int outbox(UUID workspace) {
    return count("outbox_event", workspace);
  }
}
