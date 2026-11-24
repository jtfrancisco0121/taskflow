package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.function.Supplier;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("TASK-2 concurrent structure changes")
class TaskConcurrencyIT extends TaskTestBase {

  private <T> List<T> race(List<Supplier<T>> actions) throws Exception {
    CountDownLatch go = new CountDownLatch(1);
    List<CompletableFuture<T>> futures = new ArrayList<>();
    for (Supplier<T> action : actions) {
      futures.add(
          CompletableFuture.supplyAsync(() -> {
            try {
              go.await();
            } catch (InterruptedException e) {
              throw new IllegalStateException(e);
            }
            return action.get();
          }));
    }
    go.countDown();
    List<T> out = new ArrayList<>();
    for (CompletableFuture<T> f : futures) {
      out.add(f.get());
    }
    return out;
  }

  @Test
  void crossedReparentsNeverLeaveACycle() throws Exception {
    for (int round = 0; round < 3; round++) {
      Fix f = fixture();
      TestUser m = f.ws().member();
      UUID a = task(m, f.list(), "A");
      UUID b = task(m, f.list(), "B");
      List<Integer> statuses =
          race(
              List.of(
                  () -> patchTask(m, a, 1, Map.of("parentTaskId", b)).status(),
                  () -> patchTask(f.ws().admin(), b, 1, Map.of("parentTaskId", a)).status()));
      assertThat(statuses).containsExactlyInAnyOrder(200, 409);
      UUID parentOfA =
          jdbc.queryForObject("SELECT parent_task_id FROM task WHERE id = ?", UUID.class, a);
      UUID parentOfB =
          jdbc.queryForObject("SELECT parent_task_id FROM task WHERE id = ?", UUID.class, b);
      assertThat(parentOfA != null && parentOfB != null).as("no two-task cycle").isFalse();
      assertThat(
              jdbc.queryForObject(
                  "SELECT count(*) FROM task WHERE list_id = ? AND parent_task_id IS NOT NULL",
                  Integer.class,
                  f.list()))
          .isEqualTo(1);
    }
  }

  @Test
  void parallelAppendsThenAMoveBetweenThemKeepStrictOrder() throws Exception {
    Fix f = fixture();
    TestUser m = f.ws().member();
    List<Supplier<Integer>> creates = new ArrayList<>();
    for (int i = 0; i < 10; i++) {
      String title = "T" + i;
      creates.add(() ->
          post("/api/v1/lists/" + f.list() + "/tasks", m.token(), Map.of("title", title)).status());
    }
    assertThat(race(creates)).allMatch(s -> s == 201);
    List<UUID> ordered =
        jdbc.queryForList(
            "SELECT id FROM task WHERE list_id = ? ORDER BY rank COLLATE \"C\", id",
            UUID.class,
            f.list());
    UUID mover = ordered.get(ordered.size() - 1);
    Resp r =
        move(m, mover, version(m, mover), Map.of("listId", f.list(), "beforeId", ordered.get(1)));
    assertThat(r.status()).isEqualTo(200);
    List<String> ranks =
        jdbc.queryForList(
            "SELECT rank FROM task WHERE list_id = ? ORDER BY rank COLLATE \"C\"",
            String.class,
            f.list());
    assertThat(ranks).doesNotHaveDuplicates();
    assertThat(
            jdbc.queryForList(
                    "SELECT id FROM task WHERE list_id = ? ORDER BY rank COLLATE \"C\", id",
                    UUID.class,
                    f.list())
                .indexOf(mover))
        .isEqualTo(1);
  }

  @Test
  void crossedMovesBetweenTwoListsDoNotDeadlock() throws Exception {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID other = list(m, f.space(), "Other");
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, other, "B");
    List<Integer> statuses =
        race(
            List.of(
                () -> move(m, a, 1, Map.of("listId", other)).status(),
                () -> move(m, b, 1, Map.of("listId", f.list())).status()));
    assertThat(statuses).allMatch(s -> s == 200);
  }
}
