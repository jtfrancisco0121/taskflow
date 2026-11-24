package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("TASK-2 subtasks")
class SubtaskIT extends TaskTestBase {

  @Test
  void aFourLevelChainIsBuiltAndEveryLevelStaysInTheSameList() {
    Fix f = fixture();
    UUID l1 = task(f.ws().member(), f.list(), "L1");
    UUID l2 = subtask(f.ws().member(), f.list(), l1, "L2");
    UUID l3 = subtask(f.ws().member(), f.list(), l2, "L3");
    UUID l4 = subtask(f.ws().member(), f.list(), l3, "L4");
    assertThat(read(f.ws().member(), l4).get("parentTaskId").asText()).isEqualTo(l3.toString());
    assertThat(read(f.ws().member(), l3).get("parentTaskId").asText()).isEqualTo(l2.toString());
    assertThat(read(f.ws().member(), l1).get("parentTaskId").isNull()).isTrue();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM task WHERE list_id = ? AND parent_task_id IS NOT NULL",
                Integer.class,
                f.list()))
        .isEqualTo(3);
  }

  @Test
  void aParentCycleIsRefused() {
    Fix f = fixture();
    UUID a = task(f.ws().member(), f.list(), "A");
    UUID b = subtask(f.ws().member(), f.list(), a, "B");
    UUID c = subtask(f.ws().member(), f.list(), b, "C");
    Resp underChild =
        patchTask(f.ws().member(), a, version(f.ws().member(), a), Map.of("parentTaskId", c));
    assertThat(underChild.status()).isEqualTo(409);
    assertThat(underChild.text("/code")).isEqualTo("task.parent_cycle");
    Resp underSelf =
        patchTask(f.ws().member(), a, version(f.ws().member(), a), Map.of("parentTaskId", a));
    assertThat(underSelf.status()).isEqualTo(409);
    assertThat(read(f.ws().member(), a).get("parentTaskId").isNull()).isTrue();
  }

  @Test
  void aTaskCanBeReparentedAndMadeTopLevelAgain() {
    Fix f = fixture();
    UUID a = task(f.ws().member(), f.list(), "A");
    UUID b = task(f.ws().member(), f.list(), "B");
    UUID c = subtask(f.ws().member(), f.list(), a, "C");
    Resp moved =
        patchTask(f.ws().member(), c, version(f.ws().member(), c), Map.of("parentTaskId", b));
    assertThat(moved.status()).isEqualTo(200);
    assertThat(moved.text("/parentTaskId")).isEqualTo(b.toString());
    Map<String, Object> top = new java.util.HashMap<>();
    top.put("parentTaskId", null);
    Resp cleared = patchTask(f.ws().member(), c, moved.at("/version").asLong(), top);
    assertThat(cleared.status()).isEqualTo(200);
    assertThat(cleared.at("/parentTaskId").isNull()).isTrue();
  }

  @Test
  void aParentInAnotherListOrAnInvisibleOrMissingParentIsRefused() {
    Fix f = fixture();
    UUID otherList = list(f.ws().member(), f.space(), "Other");
    UUID inOther = task(f.ws().member(), otherList, "elsewhere");
    UUID mine = task(f.ws().member(), f.list(), "mine");
    Resp create =
        post(
            "/api/v1/lists/" + f.list() + "/tasks",
            f.ws().member().token(),
            Map.of("title", "x", "parentTaskId", inOther));
    assertThat(create.status()).isEqualTo(400);
    assertThat(create.text("/code")).isEqualTo("task.parent_other_list");
    assertThat(patchTask(f.ws().member(), mine, 1, Map.of("parentTaskId", inOther)).text("/code"))
        .isEqualTo("task.parent_other_list");
    assertThat(
            patchTask(f.ws().member(), mine, 1, Map.of("parentTaskId", UUID.randomUUID())).status())
        .isEqualTo(404);

    UUID secret =
        location(
            f.ws().owner(),
            Map.of("type", "LIST", "parentId", f.space(), "name", "Secret", "isPrivate", true));
    UUID hidden = task(f.ws().owner(), secret, "hidden");
    assertThat(patchTask(f.ws().member(), mine, 1, Map.of("parentTaskId", hidden)).status())
        .isEqualTo(404);
    assertThat(
            post(
                    "/api/v1/lists/" + f.list() + "/tasks",
                    f.ws().member().token(),
                    Map.of("title", "x", "parentTaskId", hidden))
                .status())
        .isEqualTo(404);
    assertThat(read(f.ws().member(), mine).get("parentTaskId").isNull()).isTrue();
  }
}
