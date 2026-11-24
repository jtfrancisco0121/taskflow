package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("DEP-2 a relationship that closes a loop is refused")
class DependencyCycleIT extends DependencyTestBase {

  private List<String> path(Resp r) {
    List<String> out = new ArrayList<>();
    for (JsonNode n : r.at("/path")) {
      out.add(n.isNull() ? null : n.asText());
    }
    return out;
  }

  @Test
  void aWaitsOnBWaitsOnCWaitsOnAIsRefusedWithThePathAndWritesNothing() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID otherList = list(m, f.space(), "Other");
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, otherList, "B");
    UUID c = task(m, f.list(), "C");
    assertThat(relate(m, a, "WAITING_ON", b).status()).isEqualTo(201);
    assertThat(relate(m, b, "WAITING_ON", c).status()).isEqualTo(201);
    int rows = count("task_dependency", f.ws().id());
    int outbox = outbox(f.ws().id());
    long va = version(m, a);
    long vb = version(m, b);
    long vc = version(m, c);

    Resp cycle = relate(m, c, "WAITING_ON", a);
    assertThat(cycle.status()).isEqualTo(409);
    assertThat(cycle.at("/code").asText()).isEqualTo("dependency.cycle");
    assertThat(path(cycle)).containsExactly(c.toString(), a.toString(), b.toString(), c.toString());
    // the same loop, written from the other side
    assertThat(relate(m, a, "BLOCKING", c).at("/code").asText()).isEqualTo("dependency.cycle");

    assertThat(count("task_dependency", f.ws().id())).isEqualTo(rows);
    assertThat(outbox(f.ws().id())).isEqualTo(outbox);
    assertThat(version(m, a)).isEqualTo(va);
    assertThat(version(m, b)).isEqualTo(vb);
    assertThat(version(m, c)).isEqualTo(vc);
    // a link between the same tasks is not a dependency: allowed
    assertThat(relate(m, c, "LINKED", a).status()).isEqualTo(201);
  }

  @Test
  void aLoopThroughATrashedTaskIsStillRefusedSoARestoreCannotCreateOne() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, f.list(), "B");
    UUID c = task(m, f.list(), "C");
    relate(m, a, "WAITING_ON", b);
    relate(m, b, "WAITING_ON", c);
    assertThat(trash(m, b, version(m, b)).status()).isEqualTo(204);
    Resp cycle = relate(m, c, "WAITING_ON", a);
    assertThat(cycle.status()).isEqualTo(409);
    assertThat(cycle.at("/code").asText()).isEqualTo("dependency.cycle");
    // the trashed task is not shown in the path: only ids the caller may see
    assertThat(path(cycle)).containsExactly(c.toString(), a.toString(), null, c.toString());
  }

  @Test
  void twoAddsThatTogetherWouldCloseALoopCannotBothSucceed() throws Exception {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, f.list(), "B");
    UUID c = task(m, f.list(), "C");
    assertThat(relate(m, a, "WAITING_ON", b).status()).isEqualTo(201);
    long vb = version(m, b);
    long vc = version(m, c);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    CountDownLatch go = new CountDownLatch(1);
    try {
      // B waits on C and C waits on A: each is fine alone, together they close A -> B -> C -> A
      Future<Resp> one =
          pool.submit(() -> {
            go.await();
            return post(
                "/api/v1/tasks/" + b + "/dependencies",
                m.token(),
                Map.of("otherTaskId", c, "relation", "WAITING_ON"),
                "If-Match",
                "\"" + vb + "\"");
          });
      Future<Resp> two =
          pool.submit(() -> {
            go.await();
            return post(
                "/api/v1/tasks/" + c + "/dependencies",
                m.token(),
                Map.of("otherTaskId", a, "relation", "WAITING_ON"),
                "If-Match",
                "\"" + vc + "\"");
          });
      go.countDown();
      List<Integer> statuses = List.of(one.get().status(), two.get().status());
      assertThat(statuses.stream().filter(s -> s == 201).count()).isEqualTo(1);
      assertThat(statuses.stream().filter(s -> s == 409).count()).isEqualTo(1);
    } finally {
      pool.shutdownNow();
    }
    assertThat(count("task_dependency", f.ws().id())).isEqualTo(2);
  }
}
