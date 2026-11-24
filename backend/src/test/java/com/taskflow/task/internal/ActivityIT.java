package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("CMT-2 task activity log")
class ActivityIT extends TaskTestBase {

  private List<JsonNode> all(TestUser user, UUID task, int limit) {
    List<JsonNode> out = new ArrayList<>();
    String cursor = null;
    do {
      Resp r =
          get(
              "/api/v1/tasks/"
                  + task
                  + "/activity?limit="
                  + limit
                  + (cursor == null ? "" : "&cursor=" + cursor),
              user.token());
      assertThat(r.status()).isEqualTo(200);
      r.at("/items").forEach(out::add);
      cursor = r.at("/nextCursor").isNull() ? null : r.text("/nextCursor");
    } while (cursor != null);
    return out;
  }

  @Test
  void everyTaskChecklistAndCommentChangeAppearsNewestFirstWithTheActor() throws Exception {
    Fix f = fixture();
    TestUser m = f.ws().member();
    TestUser admin = f.ws().admin();
    UUID task = task(m, f.list(), "T");
    patchTask(m, task, 1, Map.of("title", "T2"));
    patchTask(admin, task, 2, Map.of("statusId", statusId(f.space(), "in progress")));
    UUID checklist =
        post("/api/v1/tasks/" + task + "/checklists", m.token(), Map.of("name", "C")).uuid("/id");
    post("/api/v1/checklists/" + checklist + "/items", m.token(), Map.of("text", "x"));
    Resp comment =
        post(
            "/api/v1/tasks/" + task + "/comments",
            admin.token(),
            Map.of("body", CommentIT.doc("hello")));
    patch(
        "/api/v1/comments/" + comment.uuid("/id"),
        admin.token(),
        Map.of("body", CommentIT.doc("hello 2")));
    delete("/api/v1/comments/" + comment.uuid("/id"), admin.token());

    List<JsonNode> items = all(m, task, 50);
    List<String> types = items.stream().map(n -> n.get("type").asText()).toList();
    assertThat(types)
        .containsExactly(
            "comment.deleted",
            "comment.edited",
            "comment.created",
            "checklist.changed",
            "checklist.changed",
            "task.status_changed",
            "task.updated",
            "task.created");
    assertThat(items.get(0).get("actorType").asText()).isEqualTo("USER");
    assertThat(items.get(0).get("actorId").asText()).isEqualTo(admin.id().toString());
    assertThat(items.get(0).get("actorName").asText()).isEqualTo("Admin");
    assertThat(items.get(7).get("actorId").asText()).isEqualTo(m.id().toString());
    assertThat(items.get(7).get("actorName").asText()).isEqualTo("Member");
    // A change made with a JWT carries no API key (S1).
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM activity_event WHERE entity_id = ? AND actor_key_id IS NOT"
                    + " NULL",
                Integer.class,
                task))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE entity_id = ? AND actor_key_id IS NOT"
                    + " NULL",
                Integer.class,
                task))
        .isZero();
    assertThat(items.get(5).get("payload").at("/changes/statusId/to").asText())
        .isEqualTo(statusId(f.space(), "in progress").toString());
    assertThat(items.get(6).get("payload").get("version").asLong()).isEqualTo(2);
  }

  @Test
  void theLogIsKeysetPaginatedWithNoDuplicatesOrGaps() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID task = task(m, f.list(), "T");
    for (int i = 0; i < 6; i++) {
      patchTask(m, task, i + 1, Map.of("title", "T" + i));
    }
    List<JsonNode> single = all(m, task, 50);
    List<JsonNode> paged = all(m, task, 2);
    assertThat(single).hasSize(7);
    assertThat(paged.stream().map(n -> n.get("id").asText()).toList())
        .doesNotHaveDuplicates()
        .isEqualTo(single.stream().map(n -> n.get("id").asText()).toList());
    Resp first = get("/api/v1/tasks/" + task + "/activity?limit=2", m.token());
    assertThat(first.at("/nextCursor").isNull()).isFalse();
    assertThat(get("/api/v1/tasks/" + task + "/activity?cursor=junk", m.token()).text("/code"))
        .isEqualTo("page.invalid_cursor");
  }
}
