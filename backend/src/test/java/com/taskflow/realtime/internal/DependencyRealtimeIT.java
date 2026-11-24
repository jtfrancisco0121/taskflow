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

/** CAP-8, AD-6: relationship and blocker events ride the task topics with ids only. */
@DisplayName("DEP real-time: relationship and blocker events over STOMP")
@TestPropertySource(properties = "taskflow.outbox.enabled=true")
class DependencyRealtimeIT extends StompTestSupport {

  /** Every frame seen so far, so the order the relay delivers two events in does not matter. */
  private final java.util.List<JsonNode> seen = new ArrayList<>();

  private JsonNode frameOfType(Conn c, String type, UUID entity, long millis) throws Exception {
    long deadline = System.currentTimeMillis() + millis;
    while (System.currentTimeMillis() < deadline) {
      for (JsonNode m : seen) {
        if (type.equals(m.get("type").asText())
            && entity.toString().equals(m.get("entityId").asText())) {
          return m;
        }
      }
      String raw = c.messages.poll(200, TimeUnit.MILLISECONDS);
      if (raw != null) {
        seen.add(mapper.readTree(raw));
      }
    }
    return null;
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

  @Test
  void relationshipAndBlockerFramesReachTheListTopicWithIdsAndVersionOnly() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    UUID waiting = task(ws.member(), list, "Confidential waiting title");
    UUID blocker = task(ws.member(), list, "Confidential blocker title");
    relayIdle(ws.id());
    UUID complete =
        jdbc.queryForObject(
            "SELECT id FROM status WHERE location_id = ? AND name = 'complete'", UUID.class, space);

    try (Conn c = connect(port, ws.member().token())) {
      assertThat(c.isConnected()).isTrue();
      c.subscribe("/topic/location/" + list);
      Thread.sleep(300);
      Resp added =
          post(
              "/api/v1/tasks/" + waiting + "/dependencies",
              ws.member().token(),
              Map.of("otherTaskId", blocker, "relation", "WAITING_ON"),
              "If-Match",
              "\"1\"");
      assertThat(added.status()).as(added.raw()).isEqualTo(201);
      JsonNode addedFrame = frameOfType(c, "task.dependency_added", waiting, 4000);
      assertThat(addedFrame).isNotNull();
      assertThat(addedFrame.get("version").asLong()).isEqualTo(2);
      assertThat(frameOfType(c, "task.dependency_added", blocker, 4000)).isNotNull();

      assertThat(patchTask(ws.member(), blocker, 2, Map.of("statusId", complete)).status())
          .isEqualTo(200);
      JsonNode resolved = frameOfType(c, "task.blocker_resolved", waiting, 4000);
      assertThat(resolved).isNotNull();
      // the dependent's version is unchanged by a blocker event
      assertThat(resolved.get("version").asLong()).isEqualTo(2);
      List<String> keys = new ArrayList<>();
      resolved.fieldNames().forEachRemaining(keys::add);
      assertThat(keys)
          .containsExactlyInAnyOrder(
              "type", "entity", "entityId", "version", "listId", "clientId", "occurredAt");
      assertThat(resolved.toString()).doesNotContain("Confidential");
      assertThat(addedFrame.toString()).doesNotContain("Confidential");
    }
  }
}
