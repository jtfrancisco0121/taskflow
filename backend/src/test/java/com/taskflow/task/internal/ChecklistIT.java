package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("TASK-2 checklists")
class ChecklistIT extends TaskTestBase {

  private List<String> texts(Resp r) {
    List<String> out = new ArrayList<>();
    for (JsonNode i : r.at("/items")) {
      out.add(i.get("text").asText());
    }
    return out;
  }

  @Test
  void checklistsAndItemsAreCreatedCheckedReorderedAndDeleted() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID task = task(m, f.list(), "T");
    Resp created =
        post("/api/v1/tasks/" + task + "/checklists", m.token(), Map.of("name", "Launch"));
    assertThat(created.status()).isEqualTo(201);
    UUID checklist = created.uuid("/id");
    assertThat(version(m, task)).isEqualTo(2);
    assertThat(get("/api/v1/tasks/" + task + "/checklists", m.token()).at("/0/items")).isEmpty();

    post("/api/v1/checklists/" + checklist + "/items", m.token(), Map.of("text", "A"));
    post("/api/v1/checklists/" + checklist + "/items", m.token(), Map.of("text", "B"));
    Resp three = post("/api/v1/checklists/" + checklist + "/items", m.token(), Map.of("text", "C"));
    assertThat(three.status()).isEqualTo(201);
    assertThat(texts(three)).containsExactly("A", "B", "C");
    UUID itemA = three.uuid("/items/0/id");
    UUID itemC = three.uuid("/items/2/id");

    Resp checked = patch("/api/v1/checklist-items/" + itemA, m.token(), Map.of("checked", true));
    assertThat(checked.status()).isEqualTo(200);
    assertThat(checked.at("/items/0/checked").asBoolean()).isTrue();

    Resp reordered =
        patch("/api/v1/checklist-items/" + itemC, m.token(), Map.of("beforeId", itemA));
    assertThat(reordered.status()).isEqualTo(200);
    assertThat(texts(reordered)).containsExactly("C", "A", "B");

    Resp renamed =
        patch(
            "/api/v1/checklist-items/" + itemA,
            m.token(),
            Map.of("text", "A2", "assigneeId", f.ws().admin().id()));
    assertThat(renamed.at("/items/1/text").asText()).isEqualTo("A2");
    assertThat(renamed.at("/items/1/assigneeId").asText())
        .isEqualTo(f.ws().admin().id().toString());
    Map<String, Object> clear = new java.util.HashMap<>();
    clear.put("assigneeId", null);
    assertThat(
            patch("/api/v1/checklist-items/" + itemA, m.token(), clear)
                .at("/items/1/assigneeId")
                .isNull())
        .isTrue();

    assertThat(delete("/api/v1/checklist-items/" + itemC, m.token()).status()).isEqualTo(204);
    UUID secondId =
        post("/api/v1/tasks/" + task + "/checklists", m.token(), Map.of("name", "Second"))
            .uuid("/id");
    Resp moved =
        patch(
            "/api/v1/checklists/" + secondId,
            m.token(),
            Map.of("beforeId", checklist, "name", "First now"));
    assertThat(moved.status()).isEqualTo(200);
    Resp all = get("/api/v1/tasks/" + task + "/checklists", m.token());
    assertThat(all.at("")).hasSize(2);
    assertThat(all.at("/0/name").asText()).isEqualTo("First now");
    assertThat(all.at("/1/name").asText()).isEqualTo("Launch");
    assertThat(all.at("/1/items/0/text").asText()).isEqualTo("A2");
    assertThat(all.at("/1/items/1/text").asText()).isEqualTo("B");

    assertThat(delete("/api/v1/checklists/" + checklist, m.token()).status()).isEqualTo(204);
    assertThat(get("/api/v1/tasks/" + task + "/checklists", m.token()).at("")).hasSize(1);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM checklist_item WHERE checklist_id = ?",
                Integer.class,
                checklist))
        .isZero();
  }

  @Test
  void everyChecklistChangeBumpsTheTaskVersionAndRecordsChecklistChanged() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID task = task(m, f.list(), "T");
    UUID checklist =
        post("/api/v1/tasks/" + task + "/checklists", m.token(), Map.of("name", "C")).uuid("/id");
    Resp item = post("/api/v1/checklists/" + checklist + "/items", m.token(), Map.of("text", "x"));
    patch(
        "/api/v1/checklist-items/" + item.uuid("/items/0/id"), m.token(), Map.of("checked", true));
    delete("/api/v1/checklist-items/" + item.uuid("/items/0/id"), m.token());
    assertThat(version(m, task)).isEqualTo(5);
    assertThat(events(task, "checklist.changed")).isEqualTo(4);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM activity_event WHERE entity = 'task' AND entity_id = ? AND type = 'checklist.changed'",
                Integer.class,
                task))
        .isEqualTo(4);
    Resp stale = patchTask(m, task, 1, Map.of("title", "late"));
    assertThat(stale.status()).isEqualTo(409);
  }

  @Test
  void invalidInputAndPermissionsAreEnforced() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID task = task(m, f.list(), "T");
    UUID checklist =
        post("/api/v1/tasks/" + task + "/checklists", m.token(), Map.of("name", "C")).uuid("/id");
    assertThat(
            post("/api/v1/tasks/" + task + "/checklists", m.token(), Map.of("name", " ")).status())
        .isEqualTo(400);
    assertThat(
            post("/api/v1/checklists/" + checklist + "/items", m.token(), Map.of("text", ""))
                .status())
        .isEqualTo(400);
    assertThat(
            post(
                    "/api/v1/checklists/" + checklist + "/items",
                    m.token(),
                    Map.of("text", "x", "assigneeId", UUID.randomUUID()))
                .text("/code"))
        .isEqualTo("checklist.invalid_assignee");
    assertThat(
            post(
                    "/api/v1/checklists/" + checklist + "/items",
                    m.token(),
                    Map.of("text", "x", "beforeId", UUID.randomUUID()))
                .text("/code"))
        .isEqualTo("rank.neighbour_out_of_scope");
    assertThat(
            patch("/api/v1/checklists/" + UUID.randomUUID(), m.token(), Map.of("name", "x"))
                .status())
        .isEqualTo(404);

    put(
        "/api/v1/locations/" + f.space() + "/grants/" + f.ws().guest().id(),
        f.ws().owner().token(),
        null);
    assertThat(
            post(
                    "/api/v1/tasks/" + task + "/checklists",
                    f.ws().guest().token(),
                    Map.of("name", "g"))
                .status())
        .isEqualTo(403);
    assertThat(
            patch("/api/v1/checklists/" + checklist, f.ws().guest().token(), Map.of("name", "g"))
                .status())
        .isEqualTo(403);
    assertThat(get("/api/v1/tasks/" + task + "/checklists", f.ws().guest().token()).status())
        .isEqualTo(200);

    UUID secret =
        location(
            f.ws().owner(),
            Map.of("type", "LIST", "parentId", f.space(), "name", "Secret", "isPrivate", true));
    UUID hidden = task(f.ws().owner(), secret, "hidden");
    UUID hiddenList =
        post("/api/v1/tasks/" + hidden + "/checklists", f.ws().owner().token(), Map.of("name", "h"))
            .uuid("/id");
    assertThat(patch("/api/v1/checklists/" + hiddenList, m.token(), Map.of("name", "x")).status())
        .isEqualTo(404);
    assertThat(
            post("/api/v1/tasks/" + hidden + "/checklists", m.token(), Map.of("name", "x"))
                .status())
        .isEqualTo(404);
  }
}
