package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("SEARCH-1 full-text search")
class TaskSearchIT extends TaskTestBase {

  private Map<String, Object> doc(String text) {
    return Map.of(
        "type",
        "doc",
        "content",
        List.of(
            Map.of("type", "paragraph", "content", List.of(Map.of("type", "text", "text", text)))));
  }

  private UUID taskWith(TestUser user, UUID list, String title, String description) {
    Resp r =
        post(
            "/api/v1/lists/" + list + "/tasks",
            user.token(),
            description == null
                ? Map.of("title", title)
                : Map.of("title", title, "description", doc(description)));
    assertThat(r.status()).as(r.raw()).isEqualTo(201);
    return r.uuid("/id");
  }

  private Resp search(TestUser user, UUID ws, String q, String... more) {
    String extra = more.length == 0 ? "" : "&" + String.join("&", more);
    return get(
        "/api/v1/workspaces/" + ws + "/search?q=" + q.replace(" ", "%20") + extra, user.token());
  }

  private List<String> titles(Resp r) {
    List<String> out = new ArrayList<>();
    r.at("/items").forEach(n -> out.add(n.get("title").asText()));
    return out;
  }

  @Test
  void aWordOnlyInTheDescriptionFindsTheTaskAndTitleMatchesRankFirst() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    taskWith(m, f.list(), "Plan the offsite", "Remember the quarterly zeppelin budget");
    taskWith(m, f.list(), "Zeppelin booking", null);
    taskWith(m, f.list(), "Unrelated", "nothing here");
    Resp r = search(m, f.ws().id(), "zeppelin");
    assertThat(r.status()).as(r.raw()).isEqualTo(200);
    assertThat(titles(r)).containsExactly("Zeppelin booking", "Plan the offsite");
    JsonNode hit = r.at("/items/1");
    assertThat(hit.get("snippet").asText()).contains("<mark>zeppelin</mark>");
    assertThat(hit.get("readableId").asText()).startsWith(f.ws().key() + "-");
    assertThat(hit.get("listName").asText()).isEqualTo("L");
  }

  @Test
  void tiptapNodeNamesDoNotMatch() {
    Fix f = fixture();
    taskWith(f.ws().member(), f.list(), "Plain", "just words");
    assertThat(titles(search(f.ws().member(), f.ws().id(), "paragraph"))).isEmpty();
    assertThat(titles(search(f.ws().member(), f.ws().id(), "doc"))).isEmpty();
  }

  @Test
  void privateListsTrashAndArchivedListsNeverAppear() {
    Fix f = fixture();
    TestUser owner = f.ws().owner();
    UUID secret = list(owner, f.space(), "Secret");
    patch("/api/v1/locations/" + secret, owner.token(), Map.of("isPrivate", true));
    UUID old = list(owner, f.space(), "Old");
    UUID hidden = taskWith(owner, secret, "Quokka private", null);
    taskWith(owner, old, "Quokka archived", null);
    UUID trashed = taskWith(f.ws().member(), f.list(), "Quokka trashed", null);
    taskWith(f.ws().member(), f.list(), "Quokka visible", null);
    post("/api/v1/locations/" + old + "/archive", owner.token(), null);
    assertThat(trash(f.ws().member(), trashed, 1).status()).isEqualTo(204);
    assertThat(titles(search(f.ws().member(), f.ws().id(), "quokka")))
        .containsExactly("Quokka visible");
    assertThat(titles(search(owner, f.ws().id(), "quokka")))
        .containsExactlyInAnyOrder("Quokka visible", "Quokka private");
    assertThat(hidden).isNotNull();
    // guests see only what they were granted
    assertThat(titles(search(f.ws().guest(), f.ws().id(), "quokka"))).isEmpty();
  }

  @Test
  void resultsPageByCursorTwentyAtATime() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    for (int i = 0; i < 45; i++) {
      taskWith(m, f.list(), "Narwhal " + i, null);
    }
    List<String> all = new ArrayList<>();
    String cursor = null;
    int pages = 0;
    do {
      Resp r = search(m, f.ws().id(), "narwhal", cursor == null ? "limit=20" : "cursor=" + cursor);
      assertThat(r.status()).as(r.raw()).isEqualTo(200);
      assertThat(r.at("/items").size()).isLessThanOrEqualTo(20);
      all.addAll(titles(r));
      cursor = r.at("/nextCursor").isNull() ? null : r.text("/nextCursor");
      pages++;
    } while (cursor != null);
    assertThat(pages).isEqualTo(3);
    assertThat(all).hasSize(45).doesNotHaveDuplicates();
    assertThat(search(m, f.ws().id(), "narwhal", "cursor=junk").status()).isEqualTo(400);
    assertThat(get("/api/v1/workspaces/" + f.ws().id() + "/search?q=", m.token()).status())
        .isEqualTo(400);
  }
}
