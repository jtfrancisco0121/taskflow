package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("CMT-1 comments and mentions")
class CommentIT extends TaskTestBase {

  static Map<String, Object> doc(String text, UUID... mentions) {
    java.util.List<Object> content = new java.util.ArrayList<>();
    content.add(Map.of("type", "text", "text", text));
    for (UUID m : mentions) {
      content.add(
          Map.of("type", "mention", "attrs", Map.of("id", m.toString(), "label", "someone")));
    }
    return Map.of(
        "type", "doc", "content", List.of(Map.of("type", "paragraph", "content", content)));
  }

  private List<UUID> mentionRows(UUID comment) {
    return jdbc.queryForList(
        "SELECT user_id FROM comment_mention WHERE comment_id = ? ORDER BY user_id",
        UUID.class,
        comment);
  }

  @Test
  void mentionsAreStoredFromTheBodyAndResyncedOnEdit() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID task = task(m, f.list(), "T");
    Resp created =
        post(
            "/api/v1/tasks/" + task + "/comments",
            m.token(),
            Map.of("body", doc("hi", f.ws().admin().id(), f.ws().owner().id())));
    assertThat(created.status()).as(created.raw()).isEqualTo(201);
    UUID comment = created.uuid("/id");
    assertThat(created.at("/mentionIds")).hasSize(2);
    assertThat(created.text("/authorId")).isEqualTo(m.id().toString());
    assertThat(mentionRows(comment))
        .containsExactlyInAnyOrder(f.ws().admin().id(), f.ws().owner().id());

    Resp edited =
        patch(
            "/api/v1/comments/" + comment,
            m.token(),
            Map.of("body", doc("edited", f.ws().guest().id())));
    assertThat(edited.status()).as(edited.raw()).isEqualTo(200);
    assertThat(edited.at("/editedAt").isNull()).isFalse();
    assertThat(mentionRows(comment)).containsExactly(f.ws().guest().id());

    Resp list = get("/api/v1/tasks/" + task + "/comments", m.token());
    assertThat(list.at("/items")).hasSize(1);
    assertThat(list.at("/items/0/body/content/0/content/0/text").asText()).isEqualTo("edited");
    assertThat(version(m, task)).as("comments do not bump the task version").isEqualTo(1);
    assertThat(events(task, "comment.created")).isEqualTo(1);
    assertThat(events(task, "comment.edited")).isEqualTo(1);
  }

  @Test
  void aMentionOfANonMemberOrAMalformedMentionIsRefused() {
    Fix f = fixture();
    Ws other = workspaceWithAllRoles();
    TestUser m = f.ws().member();
    UUID task = task(m, f.list(), "T");
    Resp foreign =
        post(
            "/api/v1/tasks/" + task + "/comments",
            m.token(),
            Map.of("body", doc("x", other.owner().id())));
    assertThat(foreign.status()).isEqualTo(400);
    assertThat(foreign.text("/code")).isEqualTo("comment.invalid_mention");
    Map<String, Object> noId =
        Map.of(
            "type",
            "doc",
            "content",
            List.of(Map.of("type", "mention", "attrs", Map.of("label", "x"))));
    assertThat(
            post("/api/v1/tasks/" + task + "/comments", m.token(), Map.of("body", noId))
                .text("/code"))
        .isEqualTo("comment.invalid_mention");
    assertThat(
            post(
                    "/api/v1/tasks/" + task + "/comments",
                    m.token(),
                    Map.of("body", Map.of("type", "paragraph")))
                .text("/code"))
        .isEqualTo("comment.invalid_body");
    assertThat(post("/api/v1/tasks/" + task + "/comments", m.token(), "{}").status())
        .isEqualTo(400);
    assertThat(get("/api/v1/tasks/" + task + "/comments", m.token()).at("/items")).isEmpty();
  }

  @Test
  void onlyTheAuthorCanEditOrDelete() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID task = task(m, f.list(), "T");
    UUID comment =
        post("/api/v1/tasks/" + task + "/comments", m.token(), Map.of("body", doc("mine")))
            .uuid("/id");
    for (TestUser other : List.of(f.ws().owner(), f.ws().admin())) {
      Resp edit =
          patch("/api/v1/comments/" + comment, other.token(), Map.of("body", doc("hijack")));
      assertThat(edit.status()).isEqualTo(403);
      assertThat(edit.text("/code")).isEqualTo("comment.not_author");
      assertThat(delete("/api/v1/comments/" + comment, other.token()).status()).isEqualTo(403);
    }
    assertThat(
            get("/api/v1/tasks/" + task + "/comments", m.token())
                .at("/items/0/body/content/0/content/0/text")
                .asText())
        .isEqualTo("mine");
    assertThat(delete("/api/v1/comments/" + comment, m.token()).status()).isEqualTo(204);
    assertThat(get("/api/v1/tasks/" + task + "/comments", m.token()).at("/items")).isEmpty();
    assertThat(
            patch("/api/v1/comments/" + comment, m.token(), Map.of("body", doc("again"))).status())
        .isEqualTo(404);
    assertThat(events(task, "comment.deleted")).isEqualTo(1);
  }

  @Test
  void aGuestWithAGrantCanCommentAndEditTheirOwnButAGuestWithoutOneSeesNothing() {
    Fix f = fixture();
    TestUser guest = f.ws().guest();
    UUID task = task(f.ws().member(), f.list(), "T");
    assertThat(
            post("/api/v1/tasks/" + task + "/comments", guest.token(), Map.of("body", doc("hi")))
                .status())
        .isEqualTo(404);
    put("/api/v1/locations/" + f.space() + "/grants/" + guest.id(), f.ws().owner().token(), null);
    Resp created =
        post("/api/v1/tasks/" + task + "/comments", guest.token(), Map.of("body", doc("hello")));
    assertThat(created.status()).isEqualTo(201);
    assertThat(
            patch(
                    "/api/v1/comments/" + created.uuid("/id"),
                    guest.token(),
                    Map.of("body", doc("hello 2")))
                .status())
        .isEqualTo(200);
    assertThat(delete("/api/v1/comments/" + created.uuid("/id"), guest.token()).status())
        .isEqualTo(204);
  }

  @Test
  void aMemberWithoutAGrantGets404OnCommentsAndActivityOfAPrivateTask() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID secret =
        location(
            f.ws().owner(),
            Map.of("type", "LIST", "parentId", f.space(), "name", "Secret", "isPrivate", true));
    UUID hidden = task(f.ws().owner(), secret, "hidden");
    UUID comment =
        post(
                "/api/v1/tasks/" + hidden + "/comments",
                f.ws().owner().token(),
                Map.of("body", doc("secret")))
            .uuid("/id");

    assertThat(get("/api/v1/tasks/" + hidden + "/comments", m.token()).status()).isEqualTo(404);
    assertThat(
            post("/api/v1/tasks/" + hidden + "/comments", m.token(), Map.of("body", doc("x")))
                .status())
        .isEqualTo(404);
    assertThat(get("/api/v1/tasks/" + hidden + "/activity", m.token()).status()).isEqualTo(404);
    assertThat(patch("/api/v1/comments/" + comment, m.token(), Map.of("body", doc("x"))).status())
        .isEqualTo(404);
    assertThat(delete("/api/v1/comments/" + comment, m.token()).status()).isEqualTo(404);
    Resp missing = get("/api/v1/tasks/" + UUID.randomUUID() + "/comments", m.token());
    assertThat(get("/api/v1/tasks/" + hidden + "/comments", m.token()).text("/code"))
        .isEqualTo(missing.text("/code"));

    put("/api/v1/locations/" + secret + "/grants/" + m.id(), f.ws().owner().token(), null);
    assertThat(get("/api/v1/tasks/" + hidden + "/comments", m.token()).at("/items")).hasSize(1);
    assertThat(get("/api/v1/tasks/" + hidden + "/activity", m.token()).status()).isEqualTo(200);
  }

  @Test
  void createIsIdempotent() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID task = task(m, f.list(), "T");
    String key = UUID.randomUUID().toString();
    Resp first =
        post(
            "/api/v1/tasks/" + task + "/comments",
            m.token(),
            Map.of("body", doc("once")),
            "Idempotency-Key",
            key);
    Resp second =
        post(
            "/api/v1/tasks/" + task + "/comments",
            m.token(),
            Map.of("body", doc("once")),
            "Idempotency-Key",
            key);
    assertThat(second.raw()).isEqualTo(first.raw());
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM comment WHERE task_id = ?", Integer.class, task))
        .isEqualTo(1);
  }

  @Test
  void commentsPageByKeyset() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID task = task(m, f.list(), "T");
    for (int i = 0; i < 5; i++) {
      post("/api/v1/tasks/" + task + "/comments", m.token(), Map.of("body", doc("c" + i)));
    }
    Resp first = get("/api/v1/tasks/" + task + "/comments?limit=3", m.token());
    assertThat(first.at("/items")).hasSize(3);
    Resp second =
        get(
            "/api/v1/tasks/" + task + "/comments?limit=3&cursor=" + first.text("/nextCursor"),
            m.token());
    assertThat(second.at("/items")).hasSize(2);
    assertThat(second.at("/nextCursor").isNull()).isTrue();
    assertThat(second.at("/items/0/id").asText()).isNotEqualTo(first.at("/items/2/id").asText());
  }
}
