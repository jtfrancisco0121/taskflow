package com.taskflow.view.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.task.TaskReader;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * 14yq6g334tg: one view query reads one snapshot. A task write that commits between the query's
 * group pick and its task load must not list the task under its old group with its new data (seen
 * once under load: a Board column "to do" returned a task already "in progress").
 */
@DisplayName("VIEW-4 a view query reads one snapshot")
class ViewQuerySnapshotIT extends ViewTestBase {

  @MockitoSpyBean TaskReader tasks;

  @Test
  void aWriteCommittedMidQueryDoesNotSplitTheGroupFromTheTask() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "Snap");
    UUID list = list(ws.owner(), space, "Board");
    UUID taskId = task(ws.owner(), list, "Beta");
    String before =
        jdbc.queryForObject("SELECT priority FROM task WHERE id = ?", String.class, taskId);
    String after = "URGENT".equals(before) ? "LOW" : "URGENT";

    // Between the group pick and the task load, another connection commits a priority change.
    AtomicReference<Boolean> wrote = new AtomicReference<>(false);
    doAnswer(
            inv -> {
              if (!wrote.getAndSet(true)) {
                CompletableFuture.runAsync(() ->
                        jdbc.update(
                            "UPDATE task SET priority = ?, version = version + 1 WHERE id = ?",
                            after,
                            taskId))
                    .get();
              }
              return inv.callRealMethod();
            })
        .when(tasks)
        .views(any());

    Map<String, Object> body = new HashMap<>();
    body.put("scope", Map.of("locationId", list));
    body.put("config", Map.of("v", 1, "group", "priority"));
    body.put("limit", 50);
    Resp r = post("/api/v1/views/query", ws.owner().token(), body);

    assertThat(r.status()).as(r.raw()).isEqualTo(200);
    assertThat(wrote.get()).isTrue();
    JsonNode item = r.at("/items/0");
    assertThat(item.at("/task/id").asText()).isEqualTo(taskId.toString());
    // The group a task is listed under is the group of the data it is listed with, and the counts
    // agree.
    assertThat(item.at("/group").asText()).isEqualTo(item.at("/task/priority").asText());
    assertThat(item.at("/group").asText()).isEqualTo(before);
    long counted = 0;
    for (JsonNode g : r.at("/groups")) {
      if (g.get("key").asText().equals(item.at("/group").asText())) {
        counted = g.get("count").asLong();
      }
    }
    assertThat(counted).isEqualTo(1);
    // The write itself landed; the next query sees it.
    Resp next = post("/api/v1/views/query", ws.owner().token(), body);
    assertThat(next.at("/items/0/group").asText()).isEqualTo(after);
    assertThat(next.at("/items/0/task/priority").asText()).isEqualTo(after);
  }
}
