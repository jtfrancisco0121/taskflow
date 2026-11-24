package com.taskflow.shared.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.IntegrationTest;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("RT-1 every event carries what routing needs (AD-12)")
class EventPayloadContractIT extends IntegrationTest {

  private long version(TestUser u, UUID task) {
    return get("/api/v1/tasks/" + task, u.token()).at("/version").asLong();
  }

  private Resp ifMatch(String method, String path, TestUser u, long v, Object body) {
    return switch (method) {
      case "PATCH" -> patch(path, u.token(), body, "If-Match", "\"" + v + "\"");
      case "DELETE" -> delete(path, u.token(), "If-Match", "\"" + v + "\"");
      default -> post(path, u.token(), body, "If-Match", "\"" + v + "\"");
    };
  }

  @Test
  void everyTaskEventHasVersionAndListIdAndEveryLocationEventHasParentIdAndPath() throws Exception {
    Ws ws = workspaceWithAllRoles();
    TestUser o = ws.owner();
    TestUser m = ws.member();
    UUID space = space(o, ws.id(), "S");
    UUID folder = folder(o, space, "F");
    UUID list = list(m, folder, "L");
    UUID other = list(m, space, "Other");
    // task events
    UUID t = task(m, list, "T");
    UUID child =
        post("/api/v1/lists/" + list + "/tasks", m.token(), Map.of("title", "c", "parentTaskId", t))
            .uuid("/id");
    assertThat(ifMatch("PATCH", "/api/v1/tasks/" + t, m, 1, Map.of("title", "T2")).status())
        .isEqualTo(200);
    String inProgress =
        jdbc.queryForObject(
            "SELECT id::text FROM status WHERE location_id = ? AND name = 'in progress'",
            String.class,
            space);
    assertThat(
            ifMatch("PATCH", "/api/v1/tasks/" + t, m, 2, Map.of("statusId", inProgress)).status())
        .isEqualTo(200);
    assertThat(
            ifMatch("POST", "/api/v1/tasks/" + t + "/move", m, 3, Map.of("listId", other)).status())
        .isEqualTo(200);
    assertThat(post("/api/v1/tasks/" + t + "/duplicate", m.token(), null).status()).isEqualTo(201);
    UUID c = task(m, other, "Trash me");
    assertThat(ifMatch("DELETE", "/api/v1/tasks/" + c, m, 1, null).status()).isEqualTo(204);
    assertThat(ifMatch("POST", "/api/v1/tasks/" + c + "/restore", m, 2, null).status())
        .isEqualTo(200);
    Resp checklist = post("/api/v1/tasks/" + c + "/checklists", m.token(), Map.of("name", "cl"));
    assertThat(checklist.status()).isEqualTo(201);
    assertThat(
            post(
                    "/api/v1/tasks/" + c + "/comments",
                    m.token(),
                    Map.of(
                        "body",
                        Map.of(
                            "type",
                            "doc",
                            "content",
                            List.of(
                                Map.of(
                                    "type",
                                    "paragraph",
                                    "content",
                                    List.of(Map.of("type", "text", "text", "hi")))))))
                .status())
        .isEqualTo(201);
    // location events
    assertThat(patch("/api/v1/locations/" + folder, o.token(), Map.of("name", "F2")).status())
        .isEqualTo(200);
    assertThat(patch("/api/v1/locations/" + folder, o.token(), Map.of("isPrivate", true)).status())
        .isEqualTo(200);
    assertThat(
            post(
                    "/api/v1/locations/" + other + "/move",
                    o.token(),
                    Map.of("parentId", space, "afterId", folder))
                .status())
        .isEqualTo(200);
    assertThat(
            post("/api/v1/locations/" + other + "/move", o.token(), Map.of("parentId", folder))
                .status())
        .isEqualTo(200);
    assertThat(
            put("/api/v1/locations/" + folder + "/grants/" + ws.guest().id(), o.token(), null)
                .status())
        .isEqualTo(204);
    assertThat(
            delete("/api/v1/locations/" + folder + "/grants/" + ws.guest().id(), o.token())
                .status())
        .isEqualTo(204);
    assertThat(post("/api/v1/locations/" + other + "/archive", o.token(), null).status())
        .isEqualTo(200);
    assertThat(post("/api/v1/locations/" + other + "/unarchive", o.token(), null).status())
        .isEqualTo(200);
    Resp statuses = get("/api/v1/locations/" + list + "/statuses", o.token());
    assertThat(statuses.status()).isEqualTo(200);
    assertThat(delete("/api/v1/locations/" + list, o.token()).status()).isEqualTo(204);

    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT entity, type, payload::text AS payload FROM outbox_event WHERE workspace_id = ?",
            ws.id());
    Set<String> taskTypes = new HashSet<>();
    Set<String> locationTypes = new HashSet<>();
    for (Map<String, Object> row : rows) {
      JsonNode p = mapper.readTree((String) row.get("payload"));
      String entity = (String) row.get("entity");
      String type = (String) row.get("type");
      if (entity.equals("task")) {
        taskTypes.add(type);
        assertThat(p.hasNonNull("version")).as(type + " version").isTrue();
        assertThat(p.hasNonNull("listId")).as(type + " listId").isTrue();
      } else if (entity.equals("location")) {
        locationTypes.add(type);
        assertThat(p.has("parentId")).as(type + " parentId").isTrue();
        assertThat(p.hasNonNull("path")).as(type + " path").isTrue();
      }
    }
    assertThat(taskTypes)
        .contains(
            "task.created",
            "task.updated",
            "task.status_changed",
            "task.moved",
            "task.duplicated",
            "task.trashed",
            "task.restored",
            "checklist.changed",
            "comment.created");
    assertThat(locationTypes)
        .contains(
            "location.created",
            "location.renamed",
            "location.privacy_changed",
            "location.moved",
            "location.reordered",
            "location.access_granted",
            "location.access_revoked",
            "location.archived",
            "location.unarchived",
            "location.deleted");
    // a moved location reports its new parent and path, and where it came from
    JsonNode moved =
        mapper.readTree(
            jdbc.queryForObject(
                "SELECT payload::text FROM outbox_event WHERE entity_id = ? AND type = 'location.moved'",
                String.class,
                other));
    assertThat(moved.get("parentId").asText()).isEqualTo(folder.toString());
    assertThat(moved.get("fromParentId").asText()).isEqualTo(space.toString());
    assertThat(child).isNotNull();
  }
}
