package com.taskflow.task.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.shared.TaskflowException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

/** Tiptap/ProseMirror JSON: stored, never rendered (conventions: rich text). */
final class RichText {

  static final int MAX_BYTES = 256 * 1024;

  private RichText() {}

  /** Checks it is a {@code type: "doc"} object of at most 256 KB; null is allowed. */
  static void validate(JsonNode doc, String code) {
    if (doc == null || doc.isNull()) {
      return;
    }
    if (!doc.isObject() || !"doc".equals(doc.path("type").asText())) {
      throw TaskflowException.badRequest(
          code, "Rich text must be a ProseMirror document (type: doc)");
    }
    if (doc.toString().getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
      throw TaskflowException.badRequest(code, "Rich text is larger than 256 KB");
    }
  }

  /** User ids of every {@code mention} node, in document order, without duplicates. */
  static Set<UUID> mentions(JsonNode doc) {
    Set<UUID> ids = new LinkedHashSet<>();
    collect(doc, ids);
    return ids;
  }

  private static void collect(JsonNode node, Set<UUID> ids) {
    if (node == null || node.isNull()) {
      return;
    }
    if ("mention".equals(node.path("type").asText())) {
      String id = node.path("attrs").path("id").asText("");
      try {
        ids.add(UUID.fromString(id));
      } catch (IllegalArgumentException e) {
        throw TaskflowException.badRequest(
            "comment.invalid_mention", "A mention needs attrs.id with a user id");
      }
    }
    node.path("content").forEach(child -> collect(child, ids));
  }
}
