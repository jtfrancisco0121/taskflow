package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("STAT-1 status remap on set changes and moves")
class StatusRemapIT extends TaskTestBase {

  @Test
  void replacingASpaceSetRemapsTasksOfInheritingListsBumpsTheirVersionAndRecordsTheEvent() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID overriding = list(m, f.space(), "Overriding");
    // The overriding List defines its own set first, so it must stay untouched.
    Resp inherited = get("/api/v1/locations/" + overriding + "/statuses", m.token());
    List<Map<String, Object>> remapAll = new java.util.ArrayList<>();
    inherited
        .at("/statuses")
        .forEach(s ->
            remapAll.add(
                Map.of(
                    "from",
                    s.get("id").asText(),
                    "to",
                    s.get("group").asText().equals("NOT_STARTED")
                            || s.get("group").asText().equals("ACTIVE")
                        ? "open"
                        : "finished")));
    assertThat(
            put(
                    "/api/v1/locations/" + overriding + "/statuses",
                    m.token(),
                    Map.of(
                        "statuses",
                        List.of(
                            Map.of("name", "open", "group", "NOT_STARTED"),
                            Map.of("name", "finished", "group", "DONE")),
                        "remap",
                        remapAll))
                .status())
        .isEqualTo(200);

    UUID inProgress = statusId(f.space(), "in progress");
    UUID closed = statusId(f.space(), "closed");
    UUID complete = statusId(f.space(), "complete");
    UUID todo = statusId(f.space(), "to do");
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, f.list(), "B");
    UUID c = task(m, f.list(), "C");
    UUID untouched = task(m, overriding, "Untouched");
    patchTask(m, a, 1, Map.of("statusId", closed));
    patchTask(m, b, 1, Map.of("statusId", inProgress));
    long versionA = version(m, a);
    long versionB = version(m, b);
    long versionC = version(m, c);
    long versionUntouched = version(m, untouched);
    UUID openStatus = statusId(overriding, "open");

    // closed -> complete (removed), in progress kept (renamed), "to do" kept.
    Resp replaced =
        put(
            "/api/v1/locations/" + f.space() + "/statuses",
            f.ws().admin().token(),
            Map.of(
                "statuses",
                List.of(
                    Map.of("id", todo, "name", "to do", "group", "NOT_STARTED"),
                    Map.of("id", inProgress, "name", "doing", "group", "ACTIVE"),
                    Map.of("id", complete, "name", "complete", "group", "DONE")),
                "remap",
                List.of(Map.of("from", closed, "to", "complete"))));
    assertThat(replaced.status()).as(replaced.raw()).isEqualTo(200);

    assertThat(read(m, a).get("statusId").asText()).isEqualTo(complete.toString());
    assertThat(read(m, a).get("version").asLong()).isEqualTo(versionA + 1);
    assertThat(events(a, "task.status_changed")).isEqualTo(2);
    assertThat(read(m, b).get("statusId").asText()).isEqualTo(inProgress.toString());
    assertThat(read(m, b).get("version").asLong())
        .as("kept statuses do not remap")
        .isEqualTo(versionB);
    assertThat(read(m, c).get("version").asLong()).isEqualTo(versionC);
    assertThat(read(m, untouched).get("statusId").asText()).isEqualTo(openStatus.toString());
    assertThat(read(m, untouched).get("version").asLong()).isEqualTo(versionUntouched);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM activity_event WHERE entity_id = ? AND type = 'task.status_changed'",
                Integer.class,
                a))
        .isEqualTo(2);
    // A stale client holding the old version can no longer overwrite the remapped task.
    assertThat(patchTask(m, a, versionA, Map.of("title", "stale")).status()).isEqualTo(409);
  }

  @Test
  void resettingAFolderToInheritRemapsItsTasks() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID folder = folder(m, f.space(), "F");
    UUID inFolder =
        jdbc.queryForObject("SELECT id FROM location WHERE parent_id = ?", UUID.class, folder);
    Resp inherited = get("/api/v1/locations/" + folder + "/statuses", m.token());
    List<Map<String, Object>> remap = new java.util.ArrayList<>();
    inherited
        .at("/statuses")
        .forEach(s -> remap.add(Map.of("from", s.get("id").asText(), "to", "a")));
    put(
        "/api/v1/locations/" + folder + "/statuses",
        m.token(),
        Map.of(
            "statuses",
            List.of(
                Map.of("name", "a", "group", "NOT_STARTED"), Map.of("name", "b", "group", "DONE")),
            "remap",
            remap));
    UUID t = task(m, inFolder, "T");
    UUID a = statusId(folder, "a");
    assertThat(read(m, t).get("statusId").asText()).isEqualTo(a.toString());

    Resp reset =
        send(
            org.springframework.http.HttpMethod.DELETE,
            "/api/v1/locations/" + folder + "/statuses",
            m.token(),
            Map.of(
                "remap",
                List.of(
                    Map.of("from", a, "to", "in progress"),
                    Map.of("from", statusId(folder, "b"), "to", "complete"))));
    assertThat(reset.status()).as(reset.raw()).isEqualTo(200);
    assertThat(read(m, t).get("statusId").asText())
        .isEqualTo(statusId(f.space(), "in progress").toString());
    assertThat(read(m, t).get("version").asLong()).isEqualTo(2);
  }

  @Test
  void movingAFolderToASpaceWithAnotherSetRemapsItsTasksToTheSameGroup() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID folder = folder(m, f.space(), "F");
    UUID list =
        jdbc.queryForObject("SELECT id FROM location WHERE parent_id = ?", UUID.class, folder);
    UUID target = space(f.ws().owner(), f.ws().id(), "Target");
    Resp current = get("/api/v1/locations/" + target + "/statuses", m.token());
    List<Map<String, Object>> remap = new java.util.ArrayList<>();
    current
        .at("/statuses")
        .forEach(s ->
            remap.add(
                Map.of(
                    "from",
                    s.get("id").asText(),
                    "to",
                    s.get("group").asText().equals("DONE")
                            || s.get("group").asText().equals("CLOSED")
                        ? "shipped"
                        : "backlog")));
    put(
        "/api/v1/locations/" + target + "/statuses",
        f.ws().owner().token(),
        Map.of(
            "statuses",
            List.of(
                Map.of("name", "backlog", "group", "NOT_STARTED"),
                Map.of("name", "shipped", "group", "DONE")),
            "remap",
            remap));

    UUID done = task(m, list, "done");
    UUID started = task(m, list, "started");
    patchTask(m, done, 1, Map.of("statusId", statusId(f.space(), "complete")));
    patchTask(m, started, 1, Map.of("statusId", statusId(f.space(), "in progress")));

    Resp moved =
        post("/api/v1/locations/" + folder + "/move", m.token(), Map.of("parentId", target));
    assertThat(moved.status()).as(moved.raw()).isEqualTo(200);
    assertThat(read(m, done).get("statusId").asText())
        .isEqualTo(statusId(target, "shipped").toString());
    assertThat(read(m, started).get("statusId").asText())
        .isEqualTo(statusId(target, "backlog").toString());
    assertThat(read(m, done).get("version").asLong()).isEqualTo(3);
    assertThat(events(done, "task.status_changed")).isEqualTo(2);
  }

  /** A remap sending every status of {@code from}'s effective set to the given new status name. */
  private List<Map<String, Object>> remapAllTo(TestUser user, UUID from, String to) {
    List<Map<String, Object>> remap = new java.util.ArrayList<>();
    get("/api/v1/locations/" + from + "/statuses", user.token())
        .at("/statuses")
        .forEach(s -> remap.add(Map.of("from", s.get("id").asText(), "to", to)));
    return remap;
  }

  private Resp firstOwnSet(TestUser user, UUID location) {
    return put(
        "/api/v1/locations/" + location + "/statuses",
        user.token(),
        Map.of(
            "statuses",
            List.of(
                Map.of("name", "a", "group", "NOT_STARTED"), Map.of("name", "b", "group", "DONE")),
            "remap",
            remapAllTo(user, location, "a")));
  }

  @Test
  void aFirstOwnSetOnAnInheritingListLeavesSiblingListTasksUntouched() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID sibling = f.list();
    UUID edited = list(m, f.space(), "Edited");
    UUID inEdited = task(m, edited, "In edited");
    UUID inSibling = task(m, sibling, "In sibling");
    UUID siblingStatus = UUID.fromString(read(m, inSibling).get("statusId").asText());
    long siblingVersion = version(m, inSibling);
    long editedVersion = version(m, inEdited);

    Resp saved = firstOwnSet(m, edited);

    assertThat(saved.status()).as(saved.raw()).isEqualTo(200);
    assertThat(read(m, inEdited).get("statusId").asText())
        .isEqualTo(statusId(edited, "a").toString());
    assertThat(read(m, inEdited).get("version").asLong()).isEqualTo(editedVersion + 1);
    assertThat(events(inEdited, "task.status_changed")).isEqualTo(1);
    assertThat(read(m, inSibling).get("statusId").asText()).isEqualTo(siblingStatus.toString());
    assertThat(read(m, inSibling).get("version").asLong())
        .as("a sibling List that still inherits is not re-statused")
        .isEqualTo(siblingVersion);
    assertThat(events(inSibling, "task.status_changed")).isZero();
  }

  @Test
  void aFirstOwnSetOnAnInheritingFolderRemapsItsListsAndLeavesASiblingListUntouched() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID sibling = f.list();
    UUID folder = folder(m, f.space(), "F");
    UUID inFolderList =
        jdbc.queryForObject("SELECT id FROM location WHERE parent_id = ?", UUID.class, folder);
    UUID inFolder = task(m, inFolderList, "In folder");
    UUID inSibling = task(m, sibling, "In sibling");
    UUID siblingStatus = UUID.fromString(read(m, inSibling).get("statusId").asText());
    long siblingVersion = version(m, inSibling);

    Resp saved = firstOwnSet(m, folder);

    assertThat(saved.status()).as(saved.raw()).isEqualTo(200);
    assertThat(read(m, inFolder).get("statusId").asText())
        .isEqualTo(statusId(folder, "a").toString());
    assertThat(read(m, inSibling).get("statusId").asText()).isEqualTo(siblingStatus.toString());
    assertThat(read(m, inSibling).get("version").asLong()).isEqualTo(siblingVersion);
    assertThat(events(inSibling, "task.status_changed")).isZero();
  }

  @Test
  void resettingAListLeavesSiblingTasksUntouched() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID sibling = f.list();
    UUID edited = list(m, f.space(), "Edited");
    assertThat(firstOwnSet(m, edited).status()).isEqualTo(200);
    UUID inEdited = task(m, edited, "In edited");
    UUID inSibling = task(m, sibling, "In sibling");
    UUID siblingStatus = UUID.fromString(read(m, inSibling).get("statusId").asText());
    long siblingVersion = version(m, inSibling);

    Resp reset =
        send(
            org.springframework.http.HttpMethod.DELETE,
            "/api/v1/locations/" + edited + "/statuses",
            m.token(),
            Map.of(
                "remap",
                List.of(
                    Map.of("from", statusId(edited, "a"), "to", "to do"),
                    Map.of("from", statusId(edited, "b"), "to", "complete"))));

    assertThat(reset.status()).as(reset.raw()).isEqualTo(200);
    assertThat(read(m, inEdited).get("statusId").asText())
        .isEqualTo(statusId(f.space(), "to do").toString());
    assertThat(read(m, inSibling).get("statusId").asText()).isEqualTo(siblingStatus.toString());
    assertThat(read(m, inSibling).get("version").asLong()).isEqualTo(siblingVersion);
    assertThat(events(inSibling, "task.status_changed")).isZero();
  }
}
