package com.taskflow;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

/** Ids from workspace B used in workspace A are refused, and reads give 404 (CAP-23, AD-16). */
@DisplayName("CAP-23 tenant isolation")
class TenantIsolationIT extends IntegrationTest {

  private record Tenant(Ws ws, UUID space, UUID list, UUID task, UUID comment, UUID checklist) {}

  private Tenant tenant(String name) {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), name);
    UUID list = list(ws.member(), space, name + " list");
    UUID task = task(ws.member(), list, name + " task");
    UUID comment =
        post(
                "/api/v1/tasks/" + task + "/comments",
                ws.member().token(),
                Map.of(
                    "body", Map.of("type", "doc", "content", List.of(Map.of("type", "paragraph")))))
            .uuid("/id");
    UUID checklist =
        post("/api/v1/tasks/" + task + "/checklists", ws.member().token(), Map.of("name", "c"))
            .uuid("/id");
    return new Tenant(ws, space, list, task, comment, checklist);
  }

  @Test
  void aUserOutsideAWorkspaceSeesNoneOfItsResources() {
    Tenant a = tenant("A");
    Tenant b = tenant("B");
    String token = a.ws().member().token();
    for (String path :
        List.of(
            "/api/v1/workspaces/" + b.ws().id(),
            "/api/v1/locations/" + b.space(),
            "/api/v1/locations/" + b.list() + "/statuses",
            "/api/v1/tasks/" + b.task(),
            "/api/v1/tasks/" + b.task() + "/comments",
            "/api/v1/tasks/" + b.task() + "/activity",
            "/api/v1/tasks/" + b.task() + "/checklists",
            "/api/v1/tasks?locationId=" + b.space(),
            "/api/v1/tasks?workspaceId=" + b.ws().id(),
            "/api/v1/workspaces/" + b.ws().id() + "/tree",
            "/api/v1/workspaces/" + b.ws().id() + "/trash",
            "/api/v1/workspaces/" + b.ws().id() + "/tasks/by-ref/" + b.ws().key() + "-1")) {
      assertThat(get(path, token).status()).as(path).isEqualTo(404);
    }
    assertThat(
            patch("/api/v1/comments/" + b.comment(), token, Map.of("body", Map.of("type", "doc")))
                .status())
        .isEqualTo(404);
    assertThat(patch("/api/v1/checklists/" + b.checklist(), token, Map.of("name", "x")).status())
        .isEqualTo(404);
    assertThat(patchTask(a.ws().member(), b.task(), 1, Map.of("title", "x")).status())
        .isEqualTo(404);
    assertThat(post("/api/v1/lists/" + b.list() + "/tasks", token, Map.of("title", "x")).status())
        .isEqualTo(404);
  }

  @Test
  void idsFromAnotherWorkspaceAreRefusedEvenForAUserWhoBelongsToBoth() {
    Tenant a = tenant("A");
    Tenant b = tenant("B");
    TestUser both = a.ws().member();
    addMember(b.ws().id(), both, "OWNER");
    String token = both.token();

    UUID foreignStatus =
        jdbc.queryForObject(
            "SELECT id FROM status WHERE location_id = ? AND name = 'to do'",
            UUID.class,
            b.space());
    Resp status =
        post(
            "/api/v1/lists/" + a.list() + "/tasks",
            token,
            Map.of("title", "x", "statusId", foreignStatus));
    assertThat(status.status()).isEqualTo(400);
    assertThat(status.text("/code")).isEqualTo("task.invalid_status");

    Resp assignee =
        post(
            "/api/v1/lists/" + a.list() + "/tasks",
            token,
            Map.of("title", "x", "assigneeIds", List.of(b.ws().admin().id())));
    assertThat(assignee.status()).isEqualTo(400);
    assertThat(assignee.text("/code")).isEqualTo("task.invalid_assignee");

    Resp parent =
        post(
            "/api/v1/lists/" + a.list() + "/tasks",
            token,
            Map.of("title", "x", "parentTaskId", b.task()));
    assertThat(parent.status()).isEqualTo(400);
    assertThat(parent.text("/code")).isEqualTo("task.parent_other_list");

    UUID aTask = task(both, a.list(), "mine");
    assertThat(move(both, aTask, b.list()).status()).isEqualTo(404);
    assertThat(patchTask(both, aTask, 1, Map.of("parentTaskId", b.task())).status()).isEqualTo(400);
    assertThat(patchTask(both, aTask, 1, Map.of("statusId", foreignStatus)).status())
        .isEqualTo(400);
    assertThat(
            patchTask(both, aTask, 1, Map.of("assigneeIds", List.of(b.ws().admin().id()))).status())
        .isEqualTo(400);

    UUID aFolder = folder(both, a.space(), "F");
    Resp locationMove =
        post("/api/v1/locations/" + aFolder + "/move", token, Map.of("parentId", b.space()));
    assertThat(locationMove.status()).isEqualTo(400);
    assertThat(locationMove.text("/code")).isEqualTo("location.invalid_parent");
    assertThat(
            post("/api/v1/locations/" + aFolder + "/move", token, Map.of("beforeId", b.list()))
                .status())
        .isEqualTo(400);

    Resp mention =
        post(
            "/api/v1/tasks/" + aTask + "/comments",
            token,
            Map.of(
                "body",
                Map.of(
                    "type",
                    "doc",
                    "content",
                    List.of(
                        Map.of(
                            "type",
                            "mention",
                            "attrs",
                            Map.of("id", b.ws().admin().id().toString()))))));
    assertThat(mention.status()).isEqualTo(400);
    Resp item =
        post(
            "/api/v1/checklists/"
                + post("/api/v1/tasks/" + aTask + "/checklists", token, Map.of("name", "c"))
                    .uuid("/id")
                + "/items",
            token,
            Map.of("text", "x", "assigneeId", b.ws().admin().id()));
    assertThat(item.status()).isEqualTo(400);
    assertThat(
            put(
                    "/api/v1/locations/" + a.space() + "/grants/" + b.ws().admin().id(),
                    a.ws().owner().token(),
                    null)
                .status())
        .isEqualTo(404);
    assertThat(
            post(
                    "/api/v1/workspaces/" + a.ws().id() + "/invites",
                    a.ws().owner().token(),
                    Map.of("email", a.ws().guest().email(), "role", "MEMBER"))
                .status())
        .isEqualTo(409);
  }

  private Resp move(TestUser user, UUID task, UUID list) {
    return post(
        "/api/v1/tasks/" + task + "/move",
        user.token(),
        Map.of("listId", list),
        "If-Match",
        "\"1\"");
  }

  @Test
  void theDatabaseRefusesCrossWorkspaceReferencesToo() {
    Tenant a = tenant("A");
    Tenant b = tenant("B");
    UUID bStatus =
        jdbc.queryForObject(
            "SELECT id FROM status WHERE location_id = ? AND name = 'to do'",
            UUID.class,
            b.space());
    UUID aStatus =
        jdbc.queryForObject(
            "SELECT id FROM status WHERE location_id = ? AND name = 'to do'",
            UUID.class,
            a.space());
    String insert =
        "INSERT INTO task (id, workspace_id, list_id, status_id, number, title, rank, created_by) VALUES (?, ?, ?, ?, ?,"
            + " 't', 'm', ?)";
    assertThatThrownBy(() ->
            jdbc.update(
                insert,
                UUID.randomUUID(),
                a.ws().id(),
                b.list(),
                aStatus,
                900,
                a.ws().owner().id()))
        .as("a task in A whose List is in B")
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(() ->
            jdbc.update(
                insert,
                UUID.randomUUID(),
                a.ws().id(),
                a.list(),
                bStatus,
                901,
                a.ws().owner().id()))
        .as("a task in A with B's status")
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(() ->
            jdbc.update(
                "INSERT INTO task_assignee (workspace_id, task_id, user_id) VALUES (?, ?, ?)",
                a.ws().id(),
                a.task(),
                b.ws().admin().id()))
        .as("an assignee who is not a member of A")
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(() ->
            jdbc.update(
                "INSERT INTO comment (id, workspace_id, task_id, author_id, body) VALUES (?, ?, ?, ?, '{}')",
                UUID.randomUUID(),
                a.ws().id(),
                b.task(),
                a.ws().owner().id()))
        .as("a comment in A on B's task")
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(() ->
            jdbc.update(
                "INSERT INTO location_grant (workspace_id, location_id, user_id, granted_by) VALUES (?, ?, ?, ?)",
                a.ws().id(),
                b.space(),
                a.ws().member().id(),
                a.ws().owner().id()))
        .as("a grant in A on B's location")
        .isInstanceOf(DataIntegrityViolationException.class);
  }
}
