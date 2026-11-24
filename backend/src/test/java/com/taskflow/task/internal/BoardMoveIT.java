package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("BOARD-1 a Board drop is one task write")
class BoardMoveIT extends TaskTestBase {

  private Map<String, Object> body(UUID list, Object... kv) {
    Map<String, Object> m = new HashMap<>();
    m.put("listId", list);
    for (int i = 0; i < kv.length; i += 2) {
      m.put((String) kv[i], kv[i + 1]);
    }
    return m;
  }

  private int activity(UUID task, String type) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM activity_event WHERE entity_id = ? AND type = ?",
        Integer.class,
        task,
        type);
  }

  private List<UUID> assignees(UUID task) {
    return jdbc.queryForList(
        "SELECT user_id FROM task_assignee WHERE task_id = ? ORDER BY user_id", UUID.class, task);
  }

  @Test
  void statusByNameAndPriorityChangeInOneVersionBumpAndOneActivityEntry() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID t = task(m, f.list(), "T");
    Resp r =
        move(
            m,
            t,
            1,
            body(f.list(), "statusName", "In Progress", "priority", "URGENT", "keepRank", true));
    assertThat(r.status()).as(r.raw()).isEqualTo(200);
    assertThat(r.at("/version").asLong()).isEqualTo(2);
    assertThat(r.text("/statusId")).isEqualTo(statusId(f.space(), "in progress").toString());
    assertThat(r.text("/priority")).isEqualTo("URGENT");
    assertThat(events(t, "task.moved")).isEqualTo(1);
    assertThat(activity(t, "task.moved")).isEqualTo(1);
  }

  @Test
  void anUnknownStatusNameIs400() {
    Fix f = fixture();
    UUID t = task(f.ws().member(), f.list(), "T");
    Resp r = move(f.ws().member(), t, 1, body(f.list(), "statusName", "nope"));
    assertThat(r.status()).isEqualTo(400);
    assertThat(r.text("/code")).isEqualTo("task.invalid_status");
  }

  @Test
  void keepRankLeavesTheRankAcrossListsAndNeighboursReorder() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID other = list(m, f.space(), "Other");
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, f.list(), "B");
    UUID c = task(m, f.list(), "C");
    String rankC = jdbc.queryForObject("SELECT rank FROM task WHERE id = ?", String.class, c);
    assertThat(move(m, c, 1, body(f.list(), "afterId", a)).status()).isEqualTo(200);
    assertThat(
            jdbc.queryForList(
                "SELECT id FROM task WHERE list_id = ? ORDER BY rank COLLATE \"C\"",
                UUID.class,
                f.list()))
        .containsExactly(a, c, b);
    String after = jdbc.queryForObject("SELECT rank FROM task WHERE id = ?", String.class, c);
    assertThat(move(m, c, 2, body(other, "keepRank", true)).status()).isEqualTo(200);
    assertThat(jdbc.queryForObject("SELECT rank FROM task WHERE id = ?", String.class, c))
        .isEqualTo(after)
        .isNotEqualTo(rankC);
    assertThat(jdbc.queryForObject("SELECT list_id FROM task WHERE id = ?", UUID.class, c))
        .isEqualTo(other);
  }

  @Test
  void assigneeDropsReplaceAddAndClearWithoutServerErrors() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID a = f.ws().owner().id();
    UUID b = f.ws().admin().id();
    UUID t = task(m, f.list(), "T");
    patchTask(m, t, 1, Map.of("assigneeIds", List.of(a)));
    long v = version(m, t);
    // replace A -> B
    Resp r = move(m, t, v, body(f.list(), "keepRank", true, "assigneeFrom", a, "assigneeTo", b));
    assertThat(r.status()).as(r.raw()).isEqualTo(200);
    assertThat(assignees(t)).containsExactly(b);
    assertThat(r.at("/version").asLong()).isEqualTo(v + 1);
    // B already assigned alongside A: only A is removed, B stays once
    patchTask(m, t, v + 1, Map.of("assigneeIds", List.of(a, b)));
    v = version(m, t);
    r = move(m, t, v, body(f.list(), "keepRank", true, "assigneeFrom", a, "assigneeTo", b));
    assertThat(r.status()).isEqualTo(200);
    assertThat(assignees(t)).containsExactly(b);
    // from Unassigned: adds
    UUID u = task(m, f.list(), "U");
    r = move(m, u, 1, body(f.list(), "keepRank", true, "assigneeTo", a));
    assertThat(r.status()).isEqualTo(200);
    assertThat(assignees(u)).containsExactly(a);
    // to Unassigned: clears every assignee
    patchTask(m, u, 2, Map.of("assigneeIds", List.of(a, b)));
    r = move(m, u, version(m, u), body(f.list(), "keepRank", true, "assigneeFrom", a));
    assertThat(r.status()).isEqualTo(200);
    assertThat(assignees(u)).isEmpty();
    // from == to: nothing changes but it is still a valid move
    r =
        move(
            m,
            u,
            version(m, u),
            body(f.list(), "keepRank", true, "assigneeFrom", a, "assigneeTo", a));
    assertThat(r.status()).isEqualTo(200);
    assertThat(assignees(u)).isEmpty();
  }

  @Test
  void aNonMemberAssigneeTargetIs400AndNothingChanges() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID outsider = signUp("Outsider").id();
    UUID t = task(m, f.list(), "T");
    Resp r = move(m, t, 1, body(f.list(), "keepRank", true, "assigneeTo", outsider));
    assertThat(r.status()).isEqualTo(400);
    assertThat(r.text("/code")).isEqualTo("task.invalid_assignee");
    assertThat(version(m, t)).isEqualTo(1);
    assertThat(assignees(t)).isEmpty();
  }

  @Test
  void aStaleVersionIs409WithTheCurrentTaskAndNoAssigneeRowChanged() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID a = f.ws().owner().id();
    UUID t = task(m, f.list(), "T");
    patchTask(m, t, 1, Map.of("title", "T2"));
    Resp r = move(m, t, 1, body(f.list(), "keepRank", true, "assigneeTo", a));
    assertThat(r.status()).isEqualTo(409);
    assertThat(r.at("/current/title").asText()).isEqualTo("T2");
    assertThat(assignees(t)).isEmpty();
  }

  @Test
  void twoParallelMovesOfOneTaskGiveOneSuccessAndOneConflict() throws Exception {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID t = task(m, f.list(), "T");
    CompletableFuture<Resp> one =
        CompletableFuture.supplyAsync(
            () -> move(m, t, 1, body(f.list(), "keepRank", true, "statusName", "in progress")));
    CompletableFuture<Resp> two =
        CompletableFuture.supplyAsync(
            () -> move(m, t, 1, body(f.list(), "keepRank", true, "priority", "HIGH")));
    List<Integer> statuses = List.of(one.get().status(), two.get().status());
    assertThat(statuses).containsExactlyInAnyOrder(200, 409);
    assertThat(version(m, t)).isEqualTo(2);
    assertThat(events(t, "task.moved")).isEqualTo(1);
  }
}
