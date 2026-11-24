package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("TASK-5 readable ids")
class TaskRefIT extends IntegrationTest {

  @Test
  void fiftyParallelCreatesGiveUniqueSequentialNumbersThatResolve() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    CountDownLatch go = new CountDownLatch(1);
    List<CompletableFuture<Resp>> futures = new ArrayList<>();
    for (int i = 0; i < 50; i++) {
      String title = "T" + i;
      futures.add(
          CompletableFuture.supplyAsync(() -> {
            try {
              go.await();
            } catch (InterruptedException e) {
              throw new IllegalStateException(e);
            }
            return post(
                "/api/v1/lists/" + list + "/tasks", ws.member().token(), Map.of("title", title));
          }));
    }
    go.countDown();
    Set<Long> numbers = new HashSet<>();
    List<Resp> created = new ArrayList<>();
    for (CompletableFuture<Resp> f : futures) {
      Resp r = f.get();
      assertThat(r.status()).isEqualTo(201);
      numbers.add(r.at("/number").asLong());
      created.add(r);
    }
    Set<Long> expected = new HashSet<>();
    for (long n = 1; n <= 50; n++) {
      expected.add(n);
    }
    assertThat(numbers).isEqualTo(expected);

    for (Resp r : created.subList(0, 5)) {
      Resp byRef =
          get(
              "/api/v1/workspaces/" + ws.id() + "/tasks/by-ref/" + r.text("/readableId"),
              ws.member().token());
      assertThat(byRef.status()).isEqualTo(200);
      assertThat(byRef.text("/id")).isEqualTo(r.text("/id"));
    }
    assertThat(
            get(
                    "/api/v1/workspaces/"
                        + ws.id()
                        + "/tasks/by-ref/"
                        + ws.key().toLowerCase()
                        + "-3",
                    ws.member().token())
                .status())
        .isEqualTo(200);
  }

  @Test
  void numbersArePerWorkspaceAndRefsDoNotCrossWorkspaces() {
    Ws one = workspaceWithAllRoles();
    Ws two = workspaceWithAllRoles();
    UUID listOne = list(one.member(), space(one.owner(), one.id(), "S"), "L");
    UUID listTwo = list(two.member(), space(two.owner(), two.id(), "S"), "L");
    UUID a = task(one.member(), listOne, "a");
    UUID b = task(two.member(), listTwo, "b");
    assertThat(get("/api/v1/tasks/" + a, one.member().token()).at("/number").asLong()).isEqualTo(1);
    assertThat(get("/api/v1/tasks/" + b, two.member().token()).at("/number").asLong()).isEqualTo(1);
    assertThat(
            get(
                    "/api/v1/workspaces/" + one.id() + "/tasks/by-ref/" + one.key() + "-1",
                    one.member().token())
                .text("/id"))
        .isEqualTo(a.toString());
    assertThat(
            get(
                    "/api/v1/workspaces/" + one.id() + "/tasks/by-ref/" + one.key() + "-99",
                    one.member().token())
                .status())
        .isEqualTo(404);
    assertThat(
            get("/api/v1/workspaces/" + one.id() + "/tasks/by-ref/ZZZZ-1", one.member().token())
                .status())
        .isEqualTo(404);
    assertThat(
            get("/api/v1/workspaces/" + one.id() + "/tasks/by-ref/nonsense", one.member().token())
                .status())
        .isEqualTo(404);
    assertThat(
            get(
                    "/api/v1/workspaces/" + two.id() + "/tasks/by-ref/" + two.key() + "-1",
                    one.member().token())
                .status())
        .isEqualTo(404);
  }
}
