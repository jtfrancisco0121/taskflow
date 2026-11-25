package com.taskflow.automation.internal;

import com.taskflow.IntegrationTest;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import org.awaitility.Awaitility;

/** Shared helpers of the engine ITs: rule bodies, waiting for runs, status ids. */
abstract class EngineSupport extends IntegrationTest {

  static Map<String, Object> statusTo(String name) {
    return Map.of("type", "STATUS_CHANGED", "toStatuses", List.of(name));
  }

  static Map<String, Object> comment(String text) {
    return Map.of("type", "ADD_COMMENT", "text", text);
  }

  static Map<String, Object> body(
      String name, Map<String, Object> trigger, List<Map<String, Object>> actions) {
    return Map.of("name", name, "trigger", trigger, "conditions", List.of(), "actions", actions);
  }

  static Map<String, Object> body(
      String name,
      Map<String, Object> trigger,
      List<Map<String, Object>> conditions,
      List<Map<String, Object>> actions) {
    return Map.of("name", name, "trigger", trigger, "conditions", conditions, "actions", actions);
  }

  protected UUID createRule(TestUser user, UUID location, Map<String, Object> body) {
    Resp r = post("/api/v1/locations/" + location + "/automations", user.token(), body);
    if (r.status() != 201) {
      throw new IllegalStateException("rule failed: " + r.status() + " " + r.raw());
    }
    return r.uuid("/id");
  }

  protected UUID statusId(TestUser user, UUID location, String name) {
    Resp r = get("/api/v1/locations/" + location + "/statuses", user.token());
    for (var s : r.at("/statuses")) {
      if (s.get("name").asText().equalsIgnoreCase(name)) {
        return UUID.fromString(s.get("id").asText());
      }
    }
    throw new IllegalStateException("no status " + name + ": " + r.raw());
  }

  protected long version(TestUser user, UUID task) {
    return get("/api/v1/tasks/" + task, user.token()).at("/version").asLong();
  }

  /** Moves the task to a status by name, at its current version. */
  protected Resp moveTo(TestUser user, UUID list, UUID task, String status) {
    return patchTask(
        user, task, version(user, task), Map.of("statusId", statusId(user, list, status)));
  }

  protected long runs(UUID rule) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM automation_run WHERE rule_id = ?", Long.class, rule);
  }

  protected <T> T await(Callable<T> check, java.util.function.Predicate<T> done) {
    return Awaitility.await()
        .atMost(Duration.ofSeconds(20))
        .pollInterval(Duration.ofMillis(100))
        .until(check, done);
  }

  protected void awaitRuns(UUID rule, long count) {
    await(() -> runs(rule), n -> n >= count);
  }

  protected void pause(long millis) {
    try {
      Thread.sleep(millis);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }

  /** The newest run of the rule on the task, or an empty map while there is none yet. */
  protected Map<String, Object> run(UUID rule, UUID task) {
    var rows =
        jdbc.queryForList(
            "SELECT status, reason, error, attempt, retryable, depth FROM automation_run WHERE"
                + " rule_id = ? AND task_id = ? ORDER BY created_at DESC LIMIT 1",
            rule,
            task);
    return rows.isEmpty() ? Map.of() : rows.get(0);
  }
}
