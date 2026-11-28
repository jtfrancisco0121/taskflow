package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.sql.Connection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@DisplayName("DEP-6 the dependency tools do what REST does, as the service account")
class McpDependenciesIT extends DependencyTestBase {

  @Autowired DataSource dataSource;

  private ToolResult add(String key, UUID task, long version, String relation, UUID other) {
    return call(
        key,
        "add_dependency",
        Map.of(
            "taskId",
            task.toString(),
            "version",
            version,
            "otherTaskId",
            other.toString(),
            "relation",
            relation));
  }

  @Test
  void addGetSearchAndRemoveWorkWithAnApiKeyAndAreAttributedToTheKey() {
    Fix f = fixture();
    Agent agent = agent(f.ws().admin(), f.ws().id(), "dep-agent", "CI-9");
    String key = agent.secret();
    UUID otherList = list(f.ws().owner(), f.space(), "Other");
    UUID a = task(f.ws().owner(), f.list(), "Agent waits");
    UUID b = task(f.ws().owner(), otherList, "Agent blocker");

    ToolResult added = add(key, a, 1, "WAITING_ON", b);
    assertThat(added.isError()).as(added.body().toString()).isFalse();
    assertThat(added.body().at("/dependency/relation").asText()).isEqualTo("WAITING_ON");
    assertThat(added.body().at("/task/version").asLong()).isEqualTo(2);
    UUID dependencyId = UUID.fromString(added.body().at("/dependency/id").asText());

    // get_task shows blocked, blockerCount and the same dependencies as REST
    ToolResult got = call(key, "get_task", Map.of("taskId", a.toString()));
    assertThat(got.body().get("blocked").asBoolean()).isTrue();
    assertThat(got.body().get("blockerCount").asInt()).isEqualTo(1);
    JsonNode rest = dependencies(f.ws().owner(), a).json();
    assertThat(got.body().get("dependencies")).isEqualTo(rest);
    assertThat(got.body().at("/dependencies/waitingOn/0/task/id").asText()).isEqualTo(b.toString());
    // by readable id too
    String ref = read(f.ws().owner(), a).get("readableId").asText();
    assertThat(call(key, "get_task", Map.of("ref", ref)).body()).isEqualTo(got.body());

    // search_tasks with blocked finds it, alone or with a query, and hits carry the flag
    ToolResult found = call(key, "search_tasks", Map.of("blocked", true));
    assertThat(found.body().at("/items")).hasSize(1);
    assertThat(found.body().at("/items/0/taskId").asText()).isEqualTo(a.toString());
    assertThat(found.body().at("/items/0/blocked").asBoolean()).isTrue();
    assertThat(
            call(key, "search_tasks", Map.of("blocked", true, "query", "waits"))
                .body()
                .at("/items"))
        .hasSize(1);
    assertThat(
            call(key, "search_tasks", Map.of("blocked", true, "query", "blocker"))
                .body()
                .at("/items"))
        .isEmpty();
    assertThat(
            call(key, "search_tasks", Map.of("blocked", true, "locationId", f.list().toString()))
                .body()
                .at("/items"))
        .hasSize(1);
    assertThat(
            call(key, "search_tasks", Map.of("blocked", true, "locationId", otherList.toString()))
                .body()
                .at("/items"))
        .isEmpty();
    assertThat(call(key, "search_tasks", Map.of("blocked", "yes")).isError()).isTrue();

    // every write is attributed to the service account and the key, on both tasks
    for (UUID t : List.of(a, b)) {
      assertThat(
              jdbc.queryForObject(
                  "SELECT actor_type || ':' || actor_id || ':' || actor_key_id FROM activity_event"
                      + " WHERE entity_id = ? AND type = 'task.dependency_added'",
                  String.class,
                  t))
          .isEqualTo("SERVICE_ACCOUNT:" + agent.id() + ":" + agent.keyId());
    }

    ToolResult removed =
        call(
            key,
            "remove_dependency",
            Map.of("taskId", a.toString(), "version", 2, "dependencyId", dependencyId.toString()));
    assertThat(removed.isError()).as(removed.body().toString()).isFalse();
    assertThat(removed.body().at("/task/version").asLong()).isEqualTo(3);
    assertThat(
            call(key, "get_task", Map.of("taskId", a.toString())).body().get("blocked").asBoolean())
        .isFalse();
    assertThat(call(key, "search_tasks", Map.of("blocked", true)).body().at("/items")).isEmpty();
  }

  @Test
  void addByReadableIdRelatesAndALinkNeverBlocks() {
    Fix f = fixture();
    String key = agent(f.ws().admin(), f.ws().id()).secret();
    UUID a = task(f.ws().owner(), f.list(), "A");
    UUID b = task(f.ws().owner(), f.list(), "B");
    String refB = read(f.ws().owner(), b).get("readableId").asText();
    ToolResult linked =
        call(
            key,
            "add_dependency",
            Map.of("taskId", a.toString(), "version", 1, "otherRef", refB, "relation", "LINKED"));
    assertThat(linked.isError()).as(linked.body().toString()).isFalse();
    assertThat(dependencies(f.ws().owner(), a).at("/linked/0/task/id").asText())
        .isEqualTo(b.toString());
    assertThat(blocked(f.ws().owner(), a)).isFalse();
  }

  @Test
  void aRetryWithTheSameIdempotencyKeyReplaysTheFirstResult() {
    Fix f = fixture();
    String key = agent(f.ws().admin(), f.ws().id()).secret();
    UUID a = task(f.ws().owner(), f.list(), "A");
    UUID b = task(f.ws().owner(), f.list(), "B");
    Map<String, Object> args =
        Map.of(
            "taskId",
            a.toString(),
            "version",
            1,
            "otherTaskId",
            b.toString(),
            "relation",
            "WAITING_ON",
            "idempotencyKey",
            "dep-key-1");
    ToolResult first = call(key, "add_dependency", args);
    ToolResult second = call(key, "add_dependency", args);
    assertThat(first.isError()).isFalse();
    assertThat(second.isError()).isFalse();
    assertThat(second.body()).isEqualTo(first.body());
    assertThat(count("task_dependency", f.ws().id())).isEqualTo(1);
    assertThat(version(f.ws().owner(), a)).isEqualTo(2);
  }

  @Test
  void aCycleAndAnUnknownDependencyAreToolErrorsWithTheRestCodes() {
    Fix f = fixture();
    String key = agent(f.ws().admin(), f.ws().id()).secret();
    UUID a = task(f.ws().owner(), f.list(), "A");
    UUID b = task(f.ws().owner(), f.list(), "B");
    UUID c = task(f.ws().owner(), f.list(), "C");
    assertThat(add(key, a, 1, "WAITING_ON", b).isError()).isFalse();
    assertThat(add(key, b, version(f.ws().owner(), b), "WAITING_ON", c).isError()).isFalse();
    ToolResult cycle = add(key, c, version(f.ws().owner(), c), "WAITING_ON", a);
    assertThat(cycle.isError()).isTrue();
    assertThat(cycle.body().get("code").asText()).isEqualTo("dependency.cycle");
    assertThat(cycle.body().at("/path")).hasSize(4);
    ToolResult self = add(key, a, version(f.ws().owner(), a), "WAITING_ON", a);
    assertThat(self.body().get("code").asText()).isEqualTo("dependency.self");
  }

  @Test
  void removeWithAnIdOfAnotherPairOrWorkspaceIsDependencyNotFoundAndChangesNothing() {
    Fix f = fixture();
    String key = agent(f.ws().admin(), f.ws().id()).secret();
    UUID x = task(f.ws().owner(), f.list(), "X");
    UUID y = task(f.ws().owner(), f.list(), "Y");
    UUID z = task(f.ws().owner(), f.list(), "Z");
    UUID yz = relate(f.ws().owner(), y, "WAITING_ON", z).uuid("/dependency/id");
    Fix other = fixture();
    UUID p = task(other.ws().owner(), other.list(), "P");
    UUID q = task(other.ws().owner(), other.list(), "Q");
    UUID pq = relate(other.ws().owner(), p, "WAITING_ON", q).uuid("/dependency/id");
    long vx = version(f.ws().owner(), x);
    long vy = version(f.ws().owner(), y);

    for (UUID foreign : List.of(yz, pq)) {
      ToolResult r =
          call(
              key,
              "remove_dependency",
              Map.of("taskId", x.toString(), "version", vx, "dependencyId", foreign.toString()));
      assertThat(r.isError()).isTrue();
      assertThat(r.body().get("code").asText()).isEqualTo("dependency.not_found");
    }
    assertThat(count("task_dependency", f.ws().id())).isEqualTo(1);
    assertThat(count("task_dependency", other.ws().id())).isEqualTo(1);
    assertThat(version(f.ws().owner(), x)).isEqualTo(vx);
    assertThat(version(f.ws().owner(), y)).isEqualTo(vy);
  }

  @Test
  void aHeldRowLockIsAToolErrorBusyAndStoresNoIdempotencyRecord() throws Exception {
    Fix f = fixture();
    String key = agent(f.ws().admin(), f.ws().id()).secret();
    UUID a = task(f.ws().owner(), f.list(), "A");
    UUID b = task(f.ws().owner(), f.list(), "B");
    Map<String, Object> args =
        Map.of(
            "taskId",
            a.toString(),
            "version",
            1,
            "otherTaskId",
            b.toString(),
            "relation",
            "WAITING_ON",
            "idempotencyKey",
            "busy-key");
    try (Connection holder = dataSource.getConnection()) {
      holder.setAutoCommit(false);
      try (var st = holder.prepareStatement("SELECT id FROM task WHERE id = ? FOR UPDATE")) {
        st.setObject(1, b);
        st.executeQuery();
      }
      ToolResult busy = call(key, "add_dependency", args);
      assertThat(busy.isError()).isTrue();
      assertThat(busy.body().get("code").asText()).isEqualTo("request.busy");
      assertThat(busy.body().get("status").asInt()).isEqualTo(503);
      assertThat(busy.body().get("retryAfterSeconds").asInt()).isEqualTo(1);
      holder.rollback();
    }
    assertThat(count("task_dependency", f.ws().id())).isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM idempotency_record WHERE key = 'busy-key'", Integer.class))
        .isZero();
    assertThat(call(key, "add_dependency", args).isError()).isFalse();
  }
}
