package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@DisplayName("TASK-4 trash, restore and purge")
class TrashIT extends TaskTestBase {

  @Autowired TaskPurgeService purge;

  private List<String> trashIds(TestUser user, UUID workspace) {
    List<String> out = new ArrayList<>();
    String cursor = null;
    do {
      Resp r =
          get(
              "/api/v1/workspaces/"
                  + workspace
                  + "/trash?limit=2"
                  + (cursor == null ? "" : "&cursor=" + cursor),
              user.token());
      assertThat(r.status()).isEqualTo(200);
      for (JsonNode n : r.at("/items")) {
        out.add(n.at("/task/id").asText());
      }
      cursor = r.at("/nextCursor").isNull() ? null : r.text("/nextCursor");
    } while (cursor != null);
    return out;
  }

  @Test
  void aDeletedTaskLeavesListingsAppearsInTheTrashAndRestoresWithItsSubtasks() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID parent = task(m, f.list(), "Parent");
    UUID child = subtask(m, f.list(), parent, "Child");
    UUID other = task(m, f.list(), "Other");

    assertThat(trash(m, parent, 1).status()).isEqualTo(204);
    assertThat(get("/api/v1/tasks/" + parent, m.token()).status()).isEqualTo(404);
    assertThat(get("/api/v1/tasks/" + child, m.token()).status()).isEqualTo(404);
    assertThat(patchTask(m, parent, 2, Map.of("title", "x")).status()).isEqualTo(404);
    Resp listing = get("/api/v1/tasks?locationId=" + f.list(), m.token());
    assertThat(listing.at("/items")).hasSize(1);
    assertThat(listing.at("/items/0/id").asText()).isEqualTo(other.toString());
    assertThat(
            get(
                    "/api/v1/workspaces/" + f.ws().id() + "/tasks/by-ref/" + f.ws().key() + "-1",
                    m.token())
                .status())
        .isEqualTo(404);

    Resp trashPage = get("/api/v1/workspaces/" + f.ws().id() + "/trash", m.token());
    assertThat(trashPage.at("/items")).hasSize(1);
    assertThat(trashPage.text("/items/0/task/id")).isEqualTo(parent.toString());
    assertThat(trashPage.at("/items/0/subtaskCount").asInt()).isEqualTo(1);
    assertThat(Instant.parse(trashPage.text("/items/0/purgeAt")))
        .isAfter(Instant.parse(trashPage.text("/items/0/deletedAt")).plusSeconds(29L * 86400));
    assertThat(events(parent, "task.trashed")).isEqualTo(1);
    assertThat(events(child, "task.trashed")).isEqualTo(1);

    long trashedVersion = trashPage.at("/items/0/task/version").asLong();
    Resp restored = restore(m, parent, trashedVersion);
    assertThat(restored.status()).as(restored.raw()).isEqualTo(200);
    assertThat(read(m, parent).get("title").asText()).isEqualTo("Parent");
    assertThat(read(m, child).get("parentTaskId").asText()).isEqualTo(parent.toString());
    assertThat(get("/api/v1/tasks?locationId=" + f.list(), m.token()).at("/items")).hasSize(3);
    assertThat(trashIds(m, f.ws().id())).isEmpty();
    assertThat(events(parent, "task.restored")).isEqualTo(1);
    assertThat(events(child, "task.restored")).isEqualTo(1);
  }

  @Test
  void deleteAndRestoreNeedTheRightVersionAndRestoreOnlyWorksOnTrash() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID t = task(m, f.list(), "T");
    assertThat(delete("/api/v1/tasks/" + t, m.token()).status()).isEqualTo(428);
    assertThat(trash(m, t, 7).status()).isEqualTo(409);
    assertThat(restore(m, t, 1).status()).isEqualTo(409);
    assertThat(trash(m, t, 1).status()).isEqualTo(204);
    assertThat(restore(m, t, 1).status()).isEqualTo(409);
    assertThat(restore(m, t, 2).status()).isEqualTo(200);
    assertThat(restore(m, t, 3).text("/code")).isEqualTo("task.not_trashed");
  }

  @Test
  void aSubtaskCannotBeRestoredWhileItsParentIsTrashed() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID parent = task(m, f.list(), "P");
    UUID child = subtask(m, f.list(), parent, "C");
    assertThat(trash(m, child, 1).status()).isEqualTo(204);
    assertThat(trash(m, parent, 1).status()).isEqualTo(204);
    Resp r = restore(m, child, 2);
    assertThat(r.status()).isEqualTo(409);
    assertThat(r.text("/code")).isEqualTo("task.parent_trashed");
    assertThat(restore(m, parent, 2).status()).isEqualTo(200);
    assertThat(read(m, child).has("id")).as("the child had its own earlier batch").isFalse();
    assertThat(restore(m, child, 2).status()).isEqualTo(200);
  }

  @Test
  void restoreIsRefusedInAnArchivedList() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID t = task(m, f.list(), "T");
    trash(m, t, 1);
    post("/api/v1/locations/" + f.list() + "/archive", m.token(), null);
    Resp r = restore(m, t, 2);
    assertThat(r.status()).isEqualTo(409);
    assertThat(r.text("/code")).isEqualTo("location.archived");
  }

  @Test
  void theTrashShowsOnlyTasksFromListsTheCallerCanSee() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID secret =
        location(
            f.ws().owner(),
            Map.of("type", "LIST", "parentId", f.space(), "name", "Secret", "isPrivate", true));
    UUID hidden = task(f.ws().owner(), secret, "hidden");
    UUID open = task(m, f.list(), "open");
    trash(f.ws().owner(), hidden, 1);
    trash(m, open, 1);

    assertThat(trashIds(m, f.ws().id())).containsExactly(open.toString());
    assertThat(trashIds(f.ws().owner(), f.ws().id()))
        .containsExactlyInAnyOrder(open.toString(), hidden.toString());
    assertThat(restore(m, hidden, 2).status()).isEqualTo(404);
    assertThat(trashIds(f.ws().guest(), f.ws().id())).isEmpty();

    put(
        "/api/v1/locations/" + secret + "/grants/" + f.ws().member().id(),
        f.ws().owner().token(),
        null);
    assertThat(trashIds(m, f.ws().id()))
        .containsExactlyInAnyOrder(open.toString(), hidden.toString());
    assertThat(restore(m, hidden, 2).status()).isEqualTo(200);
  }

  @Test
  void theTrashPagesWithoutDuplicatesOrGaps() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    List<String> expected = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      UUID t = task(m, f.list(), "t" + i);
      trash(m, t, 1);
      expected.add(t.toString());
    }
    List<String> paged = trashIds(m, f.ws().id());
    assertThat(paged)
        .hasSize(5)
        .doesNotHaveDuplicates()
        .containsExactlyInAnyOrderElementsOf(expected);
  }

  @Test
  void thePurgeRemovesBatchesOlderThan30DaysAndKeepsNewerOnes() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID old = task(m, f.list(), "old");
    UUID oldChild = subtask(m, f.list(), old, "oldChild");
    UUID recent = task(m, f.list(), "recent");
    UUID live = task(m, f.list(), "live");
    trash(m, old, 1);
    trash(m, recent, 1);
    jdbc.update(
        "UPDATE task SET deleted_at = now() - interval '31 days' WHERE id IN (?, ?)",
        old,
        oldChild);
    jdbc.update("UPDATE task SET deleted_at = now() - interval '29 days' WHERE id = ?", recent);

    int purged = purge.purge(Instant.now());
    assertThat(purged).isGreaterThanOrEqualTo(2);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM task WHERE id IN (?, ?)", Integer.class, old, oldChild))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM task WHERE id IN (?, ?)", Integer.class, recent, live))
        .isEqualTo(2);
    assertThat(events(old, "task.purged")).isEqualTo(1);
    assertThat(events(oldChild, "task.purged")).isEqualTo(1);
    assertThat(events(recent, "task.purged")).isZero();
    assertThat(purge.purge(Instant.now())).isZero();
    assertThat(purge.purge(Instant.now().plusSeconds(2L * 86400))).isGreaterThanOrEqualTo(1);
  }
}
