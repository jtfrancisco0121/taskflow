package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("AD-12 plain text becomes one paragraph per line")
class PlainTextTest {

  @Test
  void eachLineIsOneParagraph() {
    JsonNode doc = PlainText.toDoc("first\nsecond");
    assertThat(doc.get("type").asText()).isEqualTo("doc");
    assertThat(doc.get("content")).hasSize(2);
    assertThat(doc.at("/content/0/type").asText()).isEqualTo("paragraph");
    assertThat(doc.at("/content/0/content/0/type").asText()).isEqualTo("text");
    assertThat(doc.at("/content/0/content/0/text").asText()).isEqualTo("first");
    assertThat(doc.at("/content/1/content/0/text").asText()).isEqualTo("second");
  }

  @Test
  void blankLinesAreEmptyParagraphsAndLineEndingsAreNormalised() {
    JsonNode doc = PlainText.toDoc("a\r\n\r\nb\rc");
    assertThat(doc.get("content")).hasSize(4);
    assertThat(doc.at("/content/1/content").isMissingNode()).isTrue();
    assertThat(doc.at("/content/3/content/0/text").asText()).isEqualTo("c");
  }

  @Test
  void aSingleLineIsOneParagraphAndTheResultPassesRichTextValidation() {
    JsonNode doc = PlainText.toDoc("hello <b>not html</b> & \"quotes\"");
    assertThat(doc.get("content")).hasSize(1);
    assertThat(doc.at("/content/0/content/0/text").asText())
        .isEqualTo("hello <b>not html</b> & \"quotes\"");
    assertThatCode(() -> RichText.validate(doc, "x")).doesNotThrowAnyException();
  }

  @Test
  void nodesPassThroughAndNullStaysNull() {
    JsonNode ready = JsonNodeFactory.instance.objectNode().put("type", "doc");
    assertThat(PlainText.toDoc(ready)).isSameAs(ready);
    assertThat(PlainText.toDoc((JsonNode) null)).isNull();
    assertThat(PlainText.toDoc(JsonNodeFactory.instance.nullNode())).isNull();
    assertThat(PlainText.toDoc(JsonNodeFactory.instance.textNode("x")).get("type").asText())
        .isEqualTo("doc");
  }
}
