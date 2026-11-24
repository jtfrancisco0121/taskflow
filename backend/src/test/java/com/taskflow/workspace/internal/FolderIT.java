package com.taskflow.workspace.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("LOC-2 folders are optional")
class FolderIT extends IntegrationTest {

  @Test
  void aListCanLiveDirectlyInASpace() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    Resp r =
        post(
            "/api/v1/locations",
            ws.member().token(),
            Map.of("type", "LIST", "parentId", space, "name", "Direct"));
    assertThat(r.status()).isEqualTo(201);
    assertThat(r.uuid("/parentId")).isEqualTo(space);
    assertThat(r.text("/type")).isEqualTo("LIST");
  }

  @Test
  void aCreatedFolderComesBackWithExactlyOneList() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    Resp r =
        post(
            "/api/v1/locations",
            ws.member().token(),
            Map.of("type", "FOLDER", "parentId", space, "name", "F"));
    assertThat(r.status()).isEqualTo(201);
    assertThat(r.at("/children")).hasSize(1);
    assertThat(r.text("/children/0/type")).isEqualTo("LIST");
    assertThat(r.uuid("/children/0/parentId")).isEqualTo(r.uuid("/id"));
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM location WHERE parent_id = ? AND type = 'LIST'",
                Integer.class,
                r.uuid("/id")))
        .isEqualTo(1);
  }

  @Test
  void nestingRulesAreEnforced() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID folder = folder(ws.owner(), space, "F");
    UUID list = list(ws.owner(), space, "L");
    for (Map<String, Object> body :
        java.util.List.of(
            Map.<String, Object>of("type", "FOLDER", "parentId", folder, "name", "nested"),
            Map.<String, Object>of("type", "FOLDER", "parentId", list, "name", "in list"),
            Map.<String, Object>of("type", "LIST", "parentId", list, "name", "in list"),
            Map.<String, Object>of("type", "SPACE", "parentId", space, "name", "space in space"),
            Map.<String, Object>of("type", "SPACE", "name", "no workspace"),
            Map.<String, Object>of("type", "LIST", "name", "no parent"))) {
      Resp r = post("/api/v1/locations", ws.owner().token(), body);
      assertThat(r.status()).as("%s", body).isEqualTo(400);
      assertThat(r.text("/code")).startsWith("location.");
    }
  }
}
