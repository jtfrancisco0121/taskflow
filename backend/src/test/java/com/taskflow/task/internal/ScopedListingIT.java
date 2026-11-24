package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.IntegrationTest;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("LOC acceptance: tasks by ancestor scope")
class ScopedListingIT extends IntegrationTest {

  private List<UUID> all(TestUser user, String query) {
    List<UUID> out = new ArrayList<>();
    String cursor = null;
    do {
      Resp r =
          get(
              "/api/v1/tasks?" + query + "&limit=3" + (cursor == null ? "" : "&cursor=" + cursor),
              user.token());
      assertThat(r.status()).as(r.raw()).isEqualTo(200);
      for (JsonNode n : r.at("/items")) {
        out.add(UUID.fromString(n.get("id").asText()));
      }
      cursor = r.at("/nextCursor").isNull() ? null : r.text("/nextCursor");
    } while (cursor != null);
    return out;
  }

  @Test
  void aTaskInAListUnderAFolderAppearsInEveryAncestorScope() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID elsewhere = space(ws.owner(), ws.id(), "Elsewhere");
    UUID folder = folder(ws.member(), space, "F");
    UUID list =
        jdbc.queryForObject("SELECT id FROM location WHERE parent_id = ?", UUID.class, folder);
    UUID sibling = list(ws.member(), space, "Sibling");
    UUID otherList = list(ws.member(), elsewhere, "OL");
    UUID nested = task(ws.member(), list, "nested");
    UUID inSibling = task(ws.member(), sibling, "sibling");
    UUID inOther = task(ws.member(), otherList, "other");

    assertThat(all(ws.member(), "locationId=" + list)).containsExactly(nested);
    assertThat(all(ws.member(), "locationId=" + folder)).containsExactly(nested);
    assertThat(all(ws.member(), "locationId=" + space))
        .containsExactlyInAnyOrder(nested, inSibling);
    assertThat(all(ws.member(), "workspaceId=" + ws.id()))
        .containsExactlyInAnyOrder(nested, inSibling, inOther);
  }

  @Test
  void pagingAcrossMoreThanTheLimitHasNoDuplicatesOrGaps() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID folder = folder(ws.member(), space, "F");
    UUID list =
        jdbc.queryForObject("SELECT id FROM location WHERE parent_id = ?", UUID.class, folder);
    Set<UUID> created = new LinkedHashSet<>();
    for (int i = 0; i < 8; i++) {
      created.add(task(ws.member(), list, "t" + i));
    }
    UUID parent = created.iterator().next();
    created.add(
        post(
                "/api/v1/lists/" + list + "/tasks",
                ws.member().token(),
                java.util.Map.of("title", "sub", "parentTaskId", parent))
            .uuid("/id"));
    for (String scope :
        new String[] {
          "locationId=" + list,
          "locationId=" + folder,
          "locationId=" + space,
          "workspaceId=" + ws.id()
        }) {
      List<UUID> paged = all(ws.member(), scope);
      assertThat(paged).as(scope).hasSize(9).doesNotHaveDuplicates();
      assertThat(new LinkedHashSet<>(paged)).isEqualTo(created);
      assertThat(paged).isSorted();
    }
    Resp first = get("/api/v1/tasks?locationId=" + list + "&limit=4", ws.member().token());
    assertThat(first.at("/items")).hasSize(4);
    assertThat(first.at("/nextCursor").isNull()).isFalse();
  }

  @Test
  void archivedAndDeletedLocationsAreExcluded() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID kept = list(ws.member(), space, "Kept");
    UUID archived = list(ws.member(), space, "Archived");
    UUID deleted = list(ws.member(), space, "Deleted");
    UUID a = task(ws.member(), kept, "kept");
    UUID b = task(ws.member(), archived, "archived");
    task(ws.member(), deleted, "deleted");
    post("/api/v1/locations/" + archived + "/archive", ws.member().token(), null);
    delete("/api/v1/locations/" + deleted, ws.member().token());

    assertThat(all(ws.member(), "workspaceId=" + ws.id())).containsExactly(a);
    assertThat(all(ws.member(), "workspaceId=" + ws.id() + "&includeArchived=true"))
        .containsExactlyInAnyOrder(a, b);
  }

  @Test
  void theScopeParametersAreValidated() {
    Ws ws = workspaceWithAllRoles();
    Ws other = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    assertThat(get("/api/v1/tasks", ws.member().token()).text("/code"))
        .isEqualTo("task.scope_required");
    assertThat(
            get(
                    "/api/v1/tasks?locationId=" + space + "&workspaceId=" + ws.id(),
                    ws.member().token())
                .status())
        .isEqualTo(400);
    assertThat(get("/api/v1/tasks?workspaceId=" + other.id(), ws.member().token()).status())
        .isEqualTo(404);
    assertThat(get("/api/v1/tasks?locationId=" + space, other.member().token()).status())
        .isEqualTo(404);
    assertThat(
            get("/api/v1/tasks?workspaceId=" + ws.id() + "&cursor=garbage", ws.member().token())
                .text("/code"))
        .isEqualTo("page.invalid_cursor");
    assertThat(
            get("/api/v1/tasks?workspaceId=" + ws.id() + "&limit=0", ws.member().token()).status())
        .isEqualTo(400);
  }
}
