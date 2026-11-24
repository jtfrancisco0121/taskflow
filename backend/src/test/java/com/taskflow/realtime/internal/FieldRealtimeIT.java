package com.taskflow.realtime.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

/** CAP-8, AD-7: field changes ride the existing events; the live frame never carries a value. */
@DisplayName("FIELD real-time: value and definition changes over STOMP")
@TestPropertySource(properties = "taskflow.outbox.enabled=true")
class FieldRealtimeIT extends StompTestSupport {

  private JsonNode next(Conn c, long millis) throws Exception {
    String raw = c.messages.poll(millis, TimeUnit.MILLISECONDS);
    return raw == null ? null : mapper.readTree(raw);
  }

  private void relayIdle(UUID workspace) throws Exception {
    long deadline = System.currentTimeMillis() + 5000;
    while (System.currentTimeMillis() < deadline) {
      Integer open =
          jdbc.queryForObject(
              "SELECT count(*) FROM outbox_event WHERE workspace_id = ? AND published_at IS NULL",
              Integer.class,
              workspace);
      if (open != null && open == 0) {
        break;
      }
      Thread.sleep(50);
    }
    Thread.sleep(400);
  }

  private JsonNode frameOfType(Conn c, String type, long millis) throws Exception {
    long deadline = System.currentTimeMillis() + millis;
    while (System.currentTimeMillis() < deadline) {
      JsonNode m = next(c, 200);
      if (m != null && type.equals(m.get("type").asText())) {
        return m;
      }
    }
    return null;
  }

  @Test
  void aValueChangeFrameCarriesIdsTypeAndVersionOnlyWhileTheOutboxCarriesTheChange()
      throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    Resp field =
        post(
            "/api/v1/locations/" + list + "/fields",
            ws.member().token(),
            Map.of("name", "Secret plan", "type", "TEXT"));
    assertThat(field.status()).isEqualTo(201);
    UUID task = task(ws.member(), list, "T");
    relayIdle(ws.id());

    try (Conn c = connect(port, ws.member().token())) {
      assertThat(c.isConnected()).isTrue();
      c.subscribe("/topic/location/" + list);
      c.subscribe("/topic/task/" + task);
      Thread.sleep(300);
      Resp set =
          patchTask(
              ws.member(),
              task,
              1,
              Map.of("customFields", Map.of(field.text("/id"), "launch on friday")));
      assertThat(set.status()).as(set.raw()).isEqualTo(200);

      JsonNode frame = frameOfType(c, "task.updated", 4000);
      assertThat(frame).isNotNull();
      assertThat(frame.get("entityId").asText()).isEqualTo(task.toString());
      assertThat(frame.get("version").asLong()).isEqualTo(2);
      List<String> keys = new ArrayList<>();
      frame.fieldNames().forEachRemaining(keys::add);
      assertThat(keys)
          .containsExactlyInAnyOrder(
              "type", "entity", "entityId", "version", "listId", "clientId", "occurredAt");
      assertThat(frame.toString()).doesNotContain("launch on friday").doesNotContain("Secret plan");
    }

    // The outbox payload keeps the change, for consumers such as automations (AUTO-1).
    String payload =
        jdbc.queryForObject(
            "SELECT payload::text FROM outbox_event WHERE entity_id = ? AND type = 'task.updated'",
            String.class,
            task);
    assertThat(payload)
        .contains("customFields")
        .contains("launch on friday")
        .contains("Secret plan");
  }

  @Test
  void aDefinitionChangeIsALocationEventWithIdsOnly() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    relayIdle(ws.id());
    try (Conn c = connect(port, ws.member().token())) {
      c.subscribe("/topic/location/" + list);
      Thread.sleep(300);
      Resp created =
          post(
              "/api/v1/locations/" + list + "/fields",
              ws.member().token(),
              Map.of("name", "Confidential name", "type", "TEXT"));
      assertThat(created.status()).isEqualTo(201);

      JsonNode frame = frameOfType(c, "custom_field.created", 4000);
      assertThat(frame).isNotNull();
      assertThat(frame.get("entity").asText()).isEqualTo("location");
      assertThat(frame.get("entityId").asText()).isEqualTo(list.toString());
      assertThat(frame.toString()).doesNotContain("Confidential name");
    }
  }
}
