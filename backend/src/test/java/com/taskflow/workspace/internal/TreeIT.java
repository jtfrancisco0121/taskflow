package com.taskflow.workspace.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("LOC-4 lazy tree")
class TreeIT extends IntegrationTest {

  private Resp tree(TestUser user, UUID workspace, String query) {
    return get("/api/v1/workspaces/" + workspace + "/tree" + query, user.token());
  }

  @Test
  void returnsOnlyTheDirectChildrenWithHasChildren() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID emptySpace = space(ws.owner(), ws.id(), "Empty");
    UUID folder = folder(ws.member(), space, "F");
    UUID directList = list(ws.member(), space, "Direct");
    UUID nested =
        jdbc.queryForObject("SELECT id FROM location WHERE parent_id = ?", UUID.class, folder);

    Resp roots = tree(ws.member(), ws.id(), "");
    assertThat(roots.status()).isEqualTo(200);
    assertThat(roots.at("/items")).hasSize(2);
    assertThat(roots.at("/items/0/id").asText()).isEqualTo(space.toString());
    assertThat(roots.at("/items/0/hasChildren").asBoolean()).isTrue();
    assertThat(roots.at("/items/1/id").asText()).isEqualTo(emptySpace.toString());
    assertThat(roots.at("/items/1/hasChildren").asBoolean()).isFalse();

    Resp level = tree(ws.member(), ws.id(), "?parentId=" + space);
    assertThat(level.at("/items")).hasSize(2);
    assertThat(level.at("/items/0/id").asText()).isEqualTo(folder.toString());
    assertThat(level.at("/items/0/hasChildren").asBoolean()).isTrue();
    assertThat(level.at("/items/1/id").asText()).isEqualTo(directList.toString());
    assertThat(level.at("/items/1/hasChildren").asBoolean()).isFalse();
    assertThat(level.raw()).doesNotContain(nested.toString());

    Resp inner = tree(ws.member(), ws.id(), "?parentId=" + folder);
    assertThat(inner.at("/items")).hasSize(1);
    assertThat(inner.at("/items/0/id").asText()).isEqualTo(nested.toString());
  }

  @Test
  void archivedChildrenAppearOnlyWithIncludeArchived() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID kept = list(ws.member(), space, "Kept");
    UUID archived = list(ws.member(), space, "Archived");
    post("/api/v1/locations/" + archived + "/archive", ws.member().token(), null);

    assertThat(treeIds(ws.member(), ws.id(), space, false)).containsExactly(kept);
    assertThat(treeIds(ws.member(), ws.id(), space, true)).containsExactly(kept, archived);

    UUID archivedOnly = space(ws.owner(), ws.id(), "OnlyArchivedChild");
    UUID child = list(ws.member(), archivedOnly, "c");
    post("/api/v1/locations/" + child + "/archive", ws.member().token(), null);
    Resp roots = tree(ws.member(), ws.id(), "");
    for (var node : roots.at("/items")) {
      if (node.get("id").asText().equals(archivedOnly.toString())) {
        assertThat(node.get("hasChildren").asBoolean()).isFalse();
      }
    }
    Resp withArchived = tree(ws.member(), ws.id(), "?includeArchived=true");
    for (var node : withArchived.at("/items")) {
      if (node.get("id").asText().equals(archivedOnly.toString())) {
        assertThat(node.get("hasChildren").asBoolean()).isTrue();
      }
    }
  }

  @Test
  void deletedChildrenAreNeverListed() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID gone = list(ws.member(), space, "Gone");
    delete("/api/v1/locations/" + gone, ws.member().token());
    assertThat(treeIds(ws.owner(), ws.id(), space, true)).isEmpty();
    assertThat(tree(ws.owner(), ws.id(), "").at("/items/0/hasChildren").asBoolean()).isFalse();
  }

  @Test
  void aParentFromAnotherWorkspaceOrANonMemberIs404() {
    Ws one = workspaceWithAllRoles();
    Ws two = workspaceWithAllRoles();
    UUID space = space(two.owner(), two.id(), "Other");
    assertThat(tree(one.owner(), one.id(), "?parentId=" + space).status()).isEqualTo(404);
    assertThat(tree(one.owner(), two.id(), "").status()).isEqualTo(404);
    assertThat(tree(one.owner(), one.id(), "?parentId=" + UUID.randomUUID()).status())
        .isEqualTo(404);
  }
}
