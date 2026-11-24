package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("DEP-4 a blocker that crosses the finished boundary tells its dependents once")
class BlockerEventsIT extends DependencyTestBase {

  private static final String RESOLVED = "task.blocker_resolved";
  private static final String REOPENED = "task.blocker_reopened";

  private int outboxCount(UUID dependent, String type) {
    return events(dependent, type);
  }

  private int activityCount(UUID dependent, String type) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM activity_event WHERE entity_id = ? AND type = ?",
        Integer.class,
        dependent,
        type);
  }

  /** The payload of the last event of a type on a task. */
  private JsonNode last(UUID dependent, String type) {
    try {
      return mapper.readTree(
          jdbc.queryForObject(
              "SELECT payload::text FROM outbox_event WHERE entity_id = ? AND type = ? ORDER BY id"
                  + " DESC LIMIT 1",
              String.class,
              dependent,
              type));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  /** One outbox row and one activity row, and the payload carries ids only. */
  private void assertOnce(UUID dependent, String type, UUID blocker, String reason) {
    assertThat(outboxCount(dependent, type)).as(type + " outbox").isEqualTo(1);
    assertThat(activityCount(dependent, type)).as(type + " activity").isEqualTo(1);
    JsonNode p = last(dependent, type);
    assertThat(p.get("blockerId").asText()).isEqualTo(blocker.toString());
    assertThat(p.get("reason").asText()).isEqualTo(reason);
    assertThat(p.has("version")).isTrue();
    assertThat(p.has("listId")).isTrue();
    assertThat(p.has("title")).isFalse();
  }

  private void assertNone(UUID dependent) {
    assertThat(outboxCount(dependent, RESOLVED)).isZero();
    assertThat(outboxCount(dependent, REOPENED)).isZero();
  }

  @Test
  void aStatusUpdateOfTheBlockerRecordsOneEventPerDependentOnlyAcrossTheBoundary() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID blocker = task(m, f.list(), "Blocker");
    UUID d1 = task(m, f.list(), "D1");
    UUID d2 = task(m, f.list(), "D2");
    relate(m, d1, "WAITING_ON", blocker);
    relate(m, d2, "WAITING_ON", blocker);
    long dependentVersion = version(m, d1);

    // NOT_STARTED -> ACTIVE does not cross the boundary
    setStatus(m, f.space(), blocker, "in progress");
    assertNone(d1);
    assertNone(d2);

    setStatus(m, f.space(), blocker, "complete");
    assertOnce(d1, RESOLVED, blocker, "completed");
    assertOnce(d2, RESOLVED, blocker, "completed");
    assertThat(last(d1, RESOLVED).get("stillBlocked").asBoolean()).isFalse();
    // the dependent's version is not bumped by a blocker event
    assertThat(version(m, d1)).isEqualTo(dependentVersion);
    assertThat(last(d1, RESOLVED).get("version").asLong()).isEqualTo(dependentVersion);

    // DONE -> CLOSED stays finished: no new event
    setStatus(m, f.space(), blocker, "closed");
    assertThat(outboxCount(d1, RESOLVED)).isEqualTo(1);
    assertThat(outboxCount(d1, REOPENED)).isZero();

    setStatus(m, f.space(), blocker, "to do");
    assertOnce(d1, REOPENED, blocker, "reopened");
    assertOnce(d2, REOPENED, blocker, "reopened");
  }

  @Test
  void stillBlockedIsTrueWhileAnotherBlockerIsUnfinished() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID b1 = task(m, f.list(), "B1");
    UUID b2 = task(m, f.list(), "B2");
    UUID waiting = task(m, f.list(), "Waiting");
    relate(m, waiting, "WAITING_ON", b1);
    relate(m, waiting, "WAITING_ON", b2);
    setStatus(m, f.space(), b1, "complete");
    assertThat(last(waiting, RESOLVED).get("stillBlocked").asBoolean()).isTrue();
    setStatus(m, f.space(), b2, "complete");
    assertThat(last(waiting, RESOLVED).get("stillBlocked").asBoolean()).isFalse();
    assertThat(outboxCount(waiting, RESOLVED)).isEqualTo(2);
  }

  @Test
  void aBoardDropOfTheBlockerIntoDoneRecordsTheEvent() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID blocker = task(m, f.list(), "Blocker");
    UUID waiting = task(m, f.list(), "Waiting");
    relate(m, waiting, "WAITING_ON", blocker);
    Resp moved =
        move(
            m,
            blocker,
            version(m, blocker),
            Map.of("listId", f.list(), "statusName", "complete", "keepRank", true));
    assertThat(moved.status()).as(moved.raw()).isEqualTo(200);
    assertOnce(waiting, RESOLVED, blocker, "completed");
    move(
        m,
        blocker,
        version(m, blocker),
        Map.of("listId", f.list(), "statusName", "to do", "keepRank", true));
    assertOnce(waiting, REOPENED, blocker, "reopened");
  }

  @Test
  void aCrossListMoveThatMapsAClosedChildToNotStartedReopensItsDependents() {
    Fix f = fixture();
    TestUser o = f.ws().owner();
    TestUser m = f.ws().member();
    UUID space2 = space(o, f.ws().id(), "S2");
    // a set without a CLOSED status: a closed task lands on NOT_STARTED
    List<Map<String, String>> set =
        List.of(
            Map.of("name", "open", "group", "NOT_STARTED"),
            Map.of("name", "done", "group", "DONE"));
    List<Map<String, Object>> remap = new java.util.ArrayList<>();
    for (String[] r :
        new String[][] {
          {"to do", "open"}, {"in progress", "open"}, {"complete", "done"}, {"closed", "done"}
        }) {
      remap.add(Map.of("from", statusId(space2, r[0]), "to", r[1]));
    }
    assertThat(
            put(
                    "/api/v1/locations/" + space2 + "/statuses",
                    o.token(),
                    Map.of("statuses", set, "remap", remap))
                .status())
        .isEqualTo(200);
    UUID target = list(o, space2, "Target");
    UUID parent = task(m, f.list(), "Parent");
    UUID child = subtask(m, f.list(), parent, "Child blocker");
    UUID waiting = task(m, f.list(), "Waiting");
    setStatus(m, f.space(), child, "closed");
    relate(m, waiting, "WAITING_ON", child);
    assertThat(blocked(m, waiting)).isFalse();

    Resp moved = move(m, parent, version(m, parent), Map.of("listId", target));
    assertThat(moved.status()).as(moved.raw()).isEqualTo(200);
    assertThat(blocked(m, waiting)).isTrue();
    assertOnce(waiting, REOPENED, child, "reopened");
  }

  @Test
  void aStatusSetRemapThatMovesABlockerIntoDoneRecordsTheEvent() {
    Fix f = fixture();
    TestUser o = f.ws().owner();
    TestUser m = f.ws().member();
    UUID blocker = task(m, f.list(), "Blocker");
    UUID waiting = task(m, f.list(), "Waiting");
    relate(m, waiting, "WAITING_ON", blocker);
    setStatus(m, f.space(), blocker, "in progress");
    UUID todo = statusId(f.space(), "to do");
    UUID inProgress = statusId(f.space(), "in progress");
    UUID complete = statusId(f.space(), "complete");
    UUID closed = statusId(f.space(), "closed");
    // "in progress" is removed and its tasks are re-statused to "complete" (ACTIVE -> DONE)
    Resp replaced =
        put(
            "/api/v1/locations/" + f.space() + "/statuses",
            o.token(),
            Map.of(
                "statuses",
                List.of(
                    Map.of("id", todo, "name", "to do", "group", "NOT_STARTED"),
                    Map.of("id", complete, "name", "complete", "group", "DONE"),
                    Map.of("id", closed, "name", "closed", "group", "CLOSED")),
                "remap",
                List.of(Map.of("from", inProgress, "to", "complete"))));
    assertThat(replaced.status()).as(replaced.raw()).isEqualTo(200);
    assertThat(read(m, blocker).get("statusId").asText()).isEqualTo(complete.toString());
    assertOnce(waiting, RESOLVED, blocker, "completed");
  }

  @Test
  void editingTheGroupOfAKeptStatusFlipsItsBlockersBothWaysAndARenameDoesNot() {
    Fix f = fixture();
    TestUser o = f.ws().owner();
    TestUser m = f.ws().member();
    UUID blocker = task(m, f.list(), "Blocker");
    UUID other = task(m, f.list(), "Other");
    UUID waiting = task(m, f.list(), "Waiting");
    relate(m, waiting, "WAITING_ON", blocker);
    relate(m, other, "WAITING_ON", blocker);
    setStatus(m, f.space(), blocker, "in progress");
    UUID todo = statusId(f.space(), "to do");
    UUID inProgress = statusId(f.space(), "in progress");
    UUID complete = statusId(f.space(), "complete");
    UUID closed = statusId(f.space(), "closed");

    // a rename keeps the group: no event
    assertThat(
            statusSet(o, f.space(), todo, inProgress, "doing", "ACTIVE", complete, closed).status())
        .isEqualTo(200);
    assertNone(waiting);
    // ACTIVE -> DONE for the kept status: its tasks are finished now
    assertThat(
            statusSet(o, f.space(), todo, inProgress, "doing", "DONE", complete, closed).status())
        .isEqualTo(200);
    assertOnce(waiting, RESOLVED, blocker, "completed");
    assertOnce(other, RESOLVED, blocker, "completed");
    assertThat(blocked(m, waiting)).isFalse();
    // and back
    assertThat(
            statusSet(o, f.space(), todo, inProgress, "doing", "ACTIVE", complete, closed).status())
        .isEqualTo(200);
    assertOnce(waiting, REOPENED, blocker, "reopened");
    assertThat(blocked(m, waiting)).isTrue();
  }

  private Resp statusSet(
      TestUser user,
      UUID space,
      UUID todo,
      UUID kept,
      String keptName,
      String keptGroup,
      UUID complete,
      UUID closed) {
    return put(
        "/api/v1/locations/" + space + "/statuses",
        user.token(),
        Map.of(
            "statuses",
            List.of(
                Map.of("id", todo, "name", "to do", "group", "NOT_STARTED"),
                Map.of("id", kept, "name", keptName, "group", keptGroup),
                Map.of("id", complete, "name", "complete", "group", "DONE"),
                Map.of("id", closed, "name", "closed", "group", "CLOSED")),
            "remap",
            List.of()));
  }

  @Test
  void trashingAndRestoringTheBlockerRecordTheEvents() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID blocker = task(m, f.list(), "Blocker");
    UUID waiting = task(m, f.list(), "Waiting");
    relate(m, waiting, "WAITING_ON", blocker);
    assertThat(trash(m, blocker, version(m, blocker)).status()).isEqualTo(204);
    assertOnce(waiting, RESOLVED, blocker, "trashed");
    assertThat(last(waiting, RESOLVED).get("stillBlocked").asBoolean()).isFalse();
    long v = jdbc.queryForObject("SELECT version FROM task WHERE id = ?", Long.class, blocker);
    assertThat(restore(m, blocker, v).status()).isEqualTo(200);
    assertOnce(waiting, REOPENED, blocker, "restored");
  }

  @Test
  void aDependentTrashedTogetherWithItsBlockerIsNotNotified() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID parent = task(m, f.list(), "Parent");
    UUID child = subtask(m, f.list(), parent, "Child");
    relate(m, parent, "WAITING_ON", child);
    assertThat(trash(m, parent, version(m, parent)).status()).isEqualTo(204);
    assertNone(parent);
    long v = jdbc.queryForObject("SELECT version FROM task WHERE id = ?", Long.class, parent);
    assertThat(restore(m, parent, v).status()).isEqualTo(200);
    assertNone(parent);
  }

  @Test
  void completingABlockedTaskReturns200AndTheActivityMarksIt() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID blocker = task(m, f.list(), "Blocker");
    UUID waiting = task(m, f.list(), "Waiting");
    UUID free = task(m, f.list(), "Free");
    relate(m, waiting, "WAITING_ON", blocker);

    Resp done = setStatus(m, f.space(), waiting, "complete");
    assertThat(done.status()).isEqualTo(200);
    assertThat(done.at("/statusId").asText()).isEqualTo(statusId(f.space(), "complete").toString());
    JsonNode activity = last(waiting, "task.status_changed");
    assertThat(activity.get("completedWhileBlocked").asBoolean()).isTrue();
    assertThat(
            jdbc.queryForObject(
                "SELECT payload->>'completedWhileBlocked' FROM activity_event WHERE entity_id = ?"
                    + " AND type = 'task.status_changed'",
                String.class,
                waiting))
        .isEqualTo("true");
    // an unblocked task, or a move between unfinished statuses, carries no marker
    setStatus(m, f.space(), free, "complete");
    assertThat(last(free, "task.status_changed").has("completedWhileBlocked")).isFalse();
    setStatus(m, f.space(), blocker, "in progress");
    assertThat(last(blocker, "task.status_changed").has("completedWhileBlocked")).isFalse();
  }

  @Test
  void aSecondDeliveryOfTheSameWriteIsAnIdempotentNoOp() {
    // The consumer dedupes on the outbox id: every blocker event is its own outbox row with a
    // distinct id, and one activity row per outbox row.
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID blocker = task(m, f.list(), "Blocker");
    UUID waiting = task(m, f.list(), "Waiting");
    relate(m, waiting, "WAITING_ON", blocker);
    setStatus(m, f.space(), blocker, "complete");
    // an identical status patch changes nothing and records nothing more
    long v = version(m, blocker);
    assertThat(
            patchTask(m, blocker, v, Map.of("statusId", statusId(f.space(), "complete"))).status())
        .isEqualTo(200);
    assertThat(version(m, blocker)).isEqualTo(v);
    assertThat(outboxCount(waiting, RESOLVED)).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(DISTINCT id) FROM outbox_event WHERE entity_id = ? AND type = ?",
                Integer.class,
                waiting,
                RESOLVED))
        .isEqualTo(1);
  }
}
