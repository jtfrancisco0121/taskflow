package com.taskflow.task.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Agents send plain text; tasks and comments store a ProseMirror document. One paragraph per line
 * (AD-12). The result still goes through {@link RichText#validate}.
 */
final class PlainText {

  private static final JsonNodeFactory F = JsonNodeFactory.instance;

  private PlainText() {}

  /** A {@code doc} with one {@code paragraph} per line; an empty line is an empty paragraph. */
  static ObjectNode toDoc(String text) {
    ObjectNode doc = F.objectNode();
    doc.put("type", "doc");
    ArrayNode content = doc.putArray("content");
    for (String line : text.replace("\r\n", "\n").replace('\r', '\n').split("\n", -1)) {
      ObjectNode paragraph = content.addObject();
      paragraph.put("type", "paragraph");
      if (!line.isEmpty()) {
        ObjectNode run = paragraph.putArray("content").addObject();
        run.put("type", "text");
        run.put("text", line);
      }
    }
    return doc;
  }

  /** Text becomes a document; a ready-made document passes through; null stays null. */
  static JsonNode toDoc(JsonNode value) {
    if (value == null || value.isNull()) {
      return null;
    }
    return value.isTextual() ? toDoc(value.asText()) : value;
  }
}
