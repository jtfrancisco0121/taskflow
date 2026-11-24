package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.IntegrationTest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("LOC-3 private lists hide their tasks")
class PrivateTaskIT extends IntegrationTest {

  private List<String> ids(Resp page) {
    List<String> out = new ArrayList<>();
    for (JsonNode n : page.at("/items")) {
      out.add(n.get("id").asText());
    }
    return out;
  }

  @Test
  void aMemberWithoutAGrantGets404EverywhereAndAfterAGrantSeesIt() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID privateList =
        location(
            ws.owner(),
            Map.of("type", "LIST", "parentId", space, "name", "Private", "isPrivate", true));
    UUID openList = list(ws.owner(), space, "Open");
    UUID hidden = task(ws.owner(), privateList, "Hidden");
    UUID visible = task(ws.owner(), openList, "Visible");
    String ref = get("/api/v1/tasks/" + hidden, ws.owner().token()).text("/readableId");
    String member = ws.member().token();

    assertThat(get("/api/v1/tasks/" + hidden, member).status()).isEqualTo(404);
    assertThat(patchTask(ws.member(), hidden, 1, Map.of("title", "x")).status()).isEqualTo(404);
    assertThat(get("/api/v1/workspaces/" + ws.id() + "/tasks/by-ref/" + ref, member).status())
        .isEqualTo(404);
    assertThat(
            post("/api/v1/lists/" + privateList + "/tasks", member, Map.of("title", "x")).status())
        .isEqualTo(404);
    assertThat(get("/api/v1/tasks?locationId=" + privateList, member).status()).isEqualTo(404);
    assertThat(ids(get("/api/v1/tasks?workspaceId=" + ws.id(), member)))
        .containsExactly(visible.toString());
    assertThat(ids(get("/api/v1/tasks?locationId=" + space, member)))
        .containsExactly(visible.toString());
    assertThat(ids(get("/api/v1/tasks?workspaceId=" + ws.id(), ws.owner().token())))
        .containsExactlyInAnyOrder(hidden.toString(), visible.toString());
    assertThat(get("/api/v1/tasks/" + UUID.randomUUID(), member).status()).isEqualTo(404);

    put(
        "/api/v1/locations/" + privateList + "/grants/" + ws.member().id(),
        ws.owner().token(),
        null);
    assertThat(get("/api/v1/tasks/" + hidden, member).status()).isEqualTo(200);
    assertThat(patchTask(ws.member(), hidden, 1, Map.of("title", "Now allowed")).status())
        .isEqualTo(200);
    assertThat(get("/api/v1/workspaces/" + ws.id() + "/tasks/by-ref/" + ref, member).status())
        .isEqualTo(200);
    assertThat(
            post("/api/v1/lists/" + privateList + "/tasks", member, Map.of("title", "x")).status())
        .isEqualTo(201);
    assertThat(ids(get("/api/v1/tasks?workspaceId=" + ws.id(), member)))
        .contains(hidden.toString(), visible.toString());
  }

  @Test
  void aGuestSeesOnlyTasksInGrantedSubtrees() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID granted = list(ws.owner(), space, "Granted");
    UUID other = list(ws.owner(), space, "Other");
    UUID inGranted = task(ws.owner(), granted, "g");
    UUID inOther = task(ws.owner(), other, "o");
    put("/api/v1/locations/" + granted + "/grants/" + ws.guest().id(), ws.owner().token(), null);
    assertThat(get("/api/v1/tasks/" + inGranted, ws.guest().token()).status()).isEqualTo(200);
    assertThat(get("/api/v1/tasks/" + inOther, ws.guest().token()).status()).isEqualTo(404);
    assertThat(ids(get("/api/v1/tasks?workspaceId=" + ws.id(), ws.guest().token())))
        .containsExactly(inGranted.toString());
  }
}
