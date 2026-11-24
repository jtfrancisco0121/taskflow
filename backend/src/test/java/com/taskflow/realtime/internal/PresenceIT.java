package com.taskflow.realtime.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

@DisplayName("RT-2 presence")
@TestPropertySource(
    properties = {
      "taskflow.realtime.presence-ttl-ms=2500",
      "taskflow.realtime.presence-sweep-ms=500"
    })
class PresenceIT extends StompTestSupport {

  private JsonNode next(Conn c, long millis) throws Exception {
    String raw = c.messages.poll(millis, TimeUnit.MILLISECONDS);
    return raw == null ? null : mapper.readTree(raw);
  }

  private JsonNode nextWith(Conn c, UUID viewer, boolean present, long millis) throws Exception {
    long deadline = System.currentTimeMillis() + millis;
    while (System.currentTimeMillis() < deadline) {
      JsonNode m = next(c, 200);
      if (m != null) {
        boolean has = false;
        for (JsonNode v : m.get("viewers")) {
          has |= v.asText().equals(viewer.toString());
        }
        if (has == present) {
          return m;
        }
      }
    }
    return null;
  }

  @Test
  void aViewerAppearsWithinTwoSeconds() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    UUID task = task(ws.member(), list, "T");
    try (Conn a = connect(port, ws.owner().token());
        Conn b = connect(port, ws.member().token())) {
      a.subscribe("/topic/task/" + task + "/presence");
      Thread.sleep(300);
      b.subscribe("/topic/task/" + task + "/presence");
      b.session.send("/app/presence/" + task, "");
      long start = System.currentTimeMillis();
      assertThat(nextWith(a, ws.member().id(), true, 2000)).isNotNull();
      assertThat(System.currentTimeMillis() - start).isLessThan(2000);
    }
  }

  @Test
  void aViewerWhoStopsSendingHeartbeatsExpires() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    UUID task = task(ws.member(), list, "T");
    try (Conn a = connect(port, ws.owner().token());
        Conn b = connect(port, ws.member().token())) {
      a.subscribe("/topic/task/" + task + "/presence");
      Thread.sleep(300);
      b.session.send("/app/presence/" + task, "");
      assertThat(nextWith(a, ws.member().id(), true, 2000)).isNotNull();
      // no more heartbeats: the TTL (2.5 s) lapses and the sweep (0.5 s) tells the others
      assertThat(nextWith(a, ws.member().id(), false, 6000)).isNotNull();
    }
  }

  @Test
  void unsubscribingFromThePresenceTopicRemovesTheViewer() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    UUID task = task(ws.member(), list, "T");
    try (Conn a = connect(port, ws.owner().token());
        Conn b = connect(port, ws.member().token())) {
      a.subscribe("/topic/task/" + task + "/presence");
      var sub =
          b.session.subscribe(
              "/topic/task/" + task + "/presence",
              new org.springframework.messaging.simp.stomp.StompFrameHandler() {
                public java.lang.reflect.Type getPayloadType(
                    org.springframework.messaging.simp.stomp.StompHeaders h) {
                  return JsonNode.class;
                }

                public void handleFrame(
                    org.springframework.messaging.simp.stomp.StompHeaders h, Object p) {}
              });
      Thread.sleep(300);
      b.session.send("/app/presence/" + task, "");
      assertThat(nextWith(a, ws.member().id(), true, 2000)).isNotNull();
      sub.unsubscribe();
      assertThat(nextWith(a, ws.member().id(), false, 2000)).isNotNull();
    }
  }

  @Test
  void aDisconnectRemovesTheViewer() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    UUID task = task(ws.member(), list, "T");
    try (Conn a = connect(port, ws.owner().token())) {
      a.subscribe("/topic/task/" + task + "/presence");
      Conn b = connect(port, ws.member().token());
      b.subscribe("/topic/task/" + task + "/presence");
      Thread.sleep(300);
      b.session.send("/app/presence/" + task, "");
      assertThat(nextWith(a, ws.member().id(), true, 2000)).isNotNull();
      b.close();
      assertThat(nextWith(a, ws.member().id(), false, 2000)).isNotNull();
    }
  }
}
