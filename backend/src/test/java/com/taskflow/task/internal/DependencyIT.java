package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("DEP-1 relate tasks across Lists, trash and purge leave no dangling edges")
class DependencyIT extends DependencyTestBase {

  @Test
  void aCrossListRelationshipIsListedOnBothTasksAndBumpsBothVersions() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID otherList = list(m, f.space(), "Other");
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, otherList, "B");

    Resp added = relate(m, a, "WAITING_ON", b);
    assertThat(added.status()).as(added.raw()).isEqualTo(201);
    assertThat(added.at("/dependency/relation").asText()).isEqualTo("WAITING_ON");
    assertThat(added.at("/dependency/otherTaskId").asText()).isEqualTo(b.toString());
    assertThat(added.at("/task/version").asLong()).isEqualTo(2);
    assertThat(added.headers().getETag()).isEqualTo("\"2\"");
    assertThat(version(m, a)).isEqualTo(2);
    assertThat(version(m, b)).isEqualTo(2);

    JsonNode onA = dependencies(m, a).json();
    assertThat(onA.at("/waitingOn")).hasSize(1);
    assertThat(onA.at("/waitingOn/0/task/id").asText()).isEqualTo(b.toString());
    assertThat(onA.at("/waitingOn/0/task/finished").asBoolean()).isFalse();
    assertThat(onA.at("/blocking")).isEmpty();
    JsonNode onB = dependencies(m, b).json();
    assertThat(onB.at("/blocking")).hasSize(1);
    assertThat(onB.at("/blocking/0/task/id").asText()).isEqualTo(a.toString());
    assertThat(onB.at("/hiddenCount/blocking").asInt()).isZero();

    // both ends record an event with the end's new version and ids only
    assertThat(events(a, "task.dependency_added")).isEqualTo(1);
    assertThat(events(b, "task.dependency_added")).isEqualTo(1);
    JsonNode payload =
        jdbcJson("SELECT payload::text FROM outbox_event WHERE entity_id = ? AND type = ?", b);
    assertThat(payload.get("relation").asText()).isEqualTo("BLOCKING");
    assertThat(payload.get("otherTaskId").asText()).isEqualTo(a.toString());
    assertThat(payload.get("version").asLong()).isEqualTo(2);
    assertThat(payload.get("listId").asText()).isEqualTo(otherList.toString());
    assertThat(payload.has("title")).isFalse();
  }

  private JsonNode jdbcJson(String sql, UUID entity) {
    try {
      return mapper.readTree(
          jdbc.queryForObject(sql, String.class, entity, "task.dependency_added"));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  @Test
  void blockingAndBlockedByAreTheSameRelationSeenFromEachEnd() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, f.list(), "B");
    UUID c = task(m, f.list(), "C");
    assertThat(relate(m, a, "BLOCKING", b).status()).isEqualTo(201); // B waits on A
    assertThat(relate(m, c, "BLOCKED_BY", a).status()).isEqualTo(201); // C waits on A
    assertThat(dependencies(m, b).at("/waitingOn/0/task/id").asText()).isEqualTo(a.toString());
    assertThat(dependencies(m, a).at("/blocking")).hasSize(2);
    assertThat(blocked(m, b)).isTrue();
    assertThat(blocked(m, a)).isFalse();
    assertThat(relate(m, a, "FRIENDS", b).status()).isEqualTo(400);
  }

  @Test
  void aLinkIsSymmetricDoesNotBlockAndIsNotCycleChecked() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, f.list(), "B");
    assertThat(relate(m, a, "LINKED", b).status()).isEqualTo(201);
    assertThat(dependencies(m, a).at("/linked/0/task/id").asText()).isEqualTo(b.toString());
    assertThat(dependencies(m, b).at("/linked/0/task/id").asText()).isEqualTo(a.toString());
    assertThat(blocked(m, a)).isFalse();
    assertThat(blocked(m, b)).isFalse();
    // a link in either direction of the same pair already exists
    assertThat(relate(m, b, "LINKED", a).at("/code").asText()).isEqualTo("dependency.exists");
  }

  @Test
  void refusalsUseTheDocumentedCodes() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, f.list(), "B");
    UUID gone = task(m, f.list(), "Gone");
    assertThat(trash(m, gone, 1).status()).isEqualTo(204);
    Fix elsewhere = fixture();
    UUID foreign = task(elsewhere.ws().member(), elsewhere.list(), "Foreign");
    // the caller is a member of both workspaces: still not related across workspaces
    addMember(elsewhere.ws().id(), m, "MEMBER");

    Resp self = relate(m, a, "WAITING_ON", a);
    assertThat(self.status()).isEqualTo(400);
    assertThat(self.at("/code").asText()).isEqualTo("dependency.self");
    assertThat(relate(m, a, "WAITING_ON", gone).status()).isEqualTo(404);
    assertThat(relate(m, a, "WAITING_ON", foreign).status()).isEqualTo(404);
    assertThat(relate(m, a, "WAITING_ON", UUID.randomUUID()).status()).isEqualTo(404);

    assertThat(relate(m, a, "WAITING_ON", b).status()).isEqualTo(201);
    Resp again = relate(m, a, "WAITING_ON", b);
    assertThat(again.status()).isEqualTo(409);
    assertThat(again.at("/code").asText()).isEqualTo("dependency.exists");
    // any kind, either direction
    assertThat(relate(m, b, "BLOCKING", a).at("/code").asText()).isEqualTo("dependency.exists");
    assertThat(relate(m, b, "LINKED", a).at("/code").asText()).isEqualTo("dependency.exists");
    assertThat(count("task_dependency", f.ws().id())).isEqualTo(1);
  }

  @Test
  void aTaskHoldsAtMostOneHundredRelationships() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID hub = task(m, f.list(), "Hub");
    for (int i = 0; i < DependencyService.MAX_PER_TASK; i++) {
      UUID other = task(m, f.list(), "T" + i);
      jdbc.update(
          "INSERT INTO task_dependency (id, workspace_id, task_id, depends_on_id, type, created_by)"
              + " VALUES (gen_random_uuid(), ?, ?, ?, 'WAITING_ON', ?)",
          f.ws().id(),
          hub,
          other,
          m.id());
    }
    UUID one = task(m, f.list(), "One too many");
    Resp full = relate(m, hub, "WAITING_ON", one);
    assertThat(full.status()).isEqualTo(409);
    assertThat(full.at("/code").asText()).isEqualTo("dependency.limit");
    assertThat(relate(m, one, "BLOCKING", hub).at("/code").asText()).isEqualTo("dependency.limit");
  }

  @Test
  void aStaleIfMatchReturns409WithTheCurrentTaskAndWritesNothing() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, f.list(), "B");
    Resp stale =
        post(
            "/api/v1/tasks/" + a + "/dependencies",
            m.token(),
            Map.of("otherTaskId", b, "relation", "WAITING_ON"),
            "If-Match",
            "\"7\"");
    assertThat(stale.status()).isEqualTo(409);
    assertThat(stale.at("/code").asText()).isEqualTo("task.version_conflict");
    assertThat(stale.at("/current/id").asText()).isEqualTo(a.toString());
    assertThat(count("task_dependency", f.ws().id())).isZero();
    assertThat(version(m, b)).isEqualTo(1);
    assertThat(
            post(
                    "/api/v1/tasks/" + a + "/dependencies",
                    m.token(),
                    Map.of("otherTaskId", b, "relation", "WAITING_ON"))
                .status())
        .isEqualTo(428);
  }

  @Test
  void removingReturns204BumpsBothVersionsAndRecordsTheEvents() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, f.list(), "B");
    UUID dep = relate(m, a, "WAITING_ON", b).uuid("/dependency/id");
    Resp stale =
        delete("/api/v1/tasks/" + a + "/dependencies/" + dep, m.token(), "If-Match", "\"1\"");
    assertThat(stale.status()).isEqualTo(409);

    Resp removed = unrelate(m, a, dep);
    assertThat(removed.status()).isEqualTo(204);
    assertThat(removed.headers().getETag()).isEqualTo("\"3\"");
    assertThat(version(m, a)).isEqualTo(3);
    assertThat(version(m, b)).isEqualTo(3);
    assertThat(dependencies(m, a).at("/waitingOn")).isEmpty();
    assertThat(blocked(m, a)).isFalse();
    assertThat(events(a, "task.dependency_removed")).isEqualTo(1);
    assertThat(events(b, "task.dependency_removed")).isEqualTo(1);
    assertThat(unrelate(m, a, dep).status()).isEqualTo(404);
  }

  @Test
  void aTrashedTasksRelationshipsDisappearFromBothListsAndReturnOnRestore() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, f.list(), "B");
    relate(m, a, "WAITING_ON", b);
    long beforeA = version(m, a);
    assertThat(trash(m, b, version(m, b)).status()).isEqualTo(204);
    assertThat(dependencies(m, a).at("/waitingOn")).isEmpty();
    assertThat(dependencies(m, a).at("/hiddenCount/waitingOn").asInt()).isZero();
    assertThat(relate(m, a, "LINKED", b).status()).isEqualTo(404);
    assertThat(count("task_dependency", f.ws().id())).isEqualTo(1);

    long trashedVersion =
        jdbc.queryForObject("SELECT version FROM task WHERE id = ?", Long.class, b);
    int rowsBefore = count("task_dependency", f.ws().id());
    assertThat(restore(m, b, trashedVersion).status()).isEqualTo(200);
    assertThat(count("task_dependency", f.ws().id())).isEqualTo(rowsBefore);
    assertThat(dependencies(m, a).at("/waitingOn")).hasSize(1);
    assertThat(version(m, a)).isEqualTo(beforeA);
    assertThat(dependencies(m, b).at("/blocking")).hasSize(1);
  }

  @Test
  void purgingATaskDeletesItsRelationshipRows() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, f.list(), "B");
    relate(m, a, "WAITING_ON", b);
    assertThat(count("task_dependency", f.ws().id())).isEqualTo(1);
    jdbc.update("DELETE FROM task WHERE id = ?", b);
    assertThat(count("task_dependency", f.ws().id())).isZero();
    assertThat(dependencies(m, a).at("/waitingOn")).isEmpty();
  }

  @Test
  void aRelationshipToAPrivateTaskIsOnlyCounted() {
    Fix f = fixture();
    TestUser owner = f.ws().owner();
    UUID privateList =
        location(
            owner,
            Map.of("type", "LIST", "parentId", f.space(), "name", "Private", "isPrivate", true));
    UUID open = task(f.ws().member(), f.list(), "Open");
    UUID secret = task(owner, privateList, "Secret");
    // the owner relates them; the member then sees only a count
    assertThat(relate(owner, open, "WAITING_ON", secret).status()).isEqualTo(201);
    JsonNode seen = dependencies(f.ws().member(), open).json();
    assertThat(seen.at("/waitingOn")).isEmpty();
    assertThat(seen.at("/hiddenCount/waitingOn").asInt()).isEqualTo(1);
    assertThat(seen.toString()).doesNotContain("Secret");
    // hidden blockers still make the task blocked
    assertThat(blocked(f.ws().member(), open)).isTrue();
    assertThat(dependencies(owner, open).at("/waitingOn/0/task/title").asText())
        .isEqualTo("Secret");
    // the member cannot relate to the private task: 404
    UUID other = task(f.ws().member(), f.list(), "Other");
    assertThat(relate(f.ws().member(), other, "WAITING_ON", secret).status()).isEqualTo(404);
  }

  @Test
  void activityOfBothTasksCarriesTheActor() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, f.list(), "B");
    relate(m, a, "WAITING_ON", b);
    for (UUID t : List.of(a, b)) {
      assertThat(
              jdbc.queryForObject(
                  "SELECT actor_id FROM activity_event WHERE entity_id = ? AND type ="
                      + " 'task.dependency_added'",
                  UUID.class,
                  t))
          .isEqualTo(m.id());
    }
  }
}
