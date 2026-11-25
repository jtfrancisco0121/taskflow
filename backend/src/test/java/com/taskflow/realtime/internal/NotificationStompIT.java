package com.taskflow.realtime.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

@DisplayName("CAP-12 live delivery over the user topic")
@TestPropertySource(
    properties = {
      "taskflow.workers.enabled=true",
      "taskflow.outbox.amqp.enabled=true",
      "taskflow.outbox.enabled=true"
    })
class NotificationStompIT extends StompTestSupport {

  @Test
  void notificationCreatedReachesTheRecipientsTopicAndNoOther() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.owner(), space, "L");
    try (Conn member = connect(port, ws.member().token());
        Conn admin = connect(port, ws.admin().token())) {
      member.subscribe("/topic/user/" + ws.member().id());
      admin.subscribe("/topic/user/" + ws.admin().id());
      Thread.sleep(300);
      Resp r =
          post(
              "/api/v1/lists/" + list + "/tasks",
              ws.owner().token(),
              Map.of("title", "Assign", "assigneeIds", List.of(ws.member().id())));
      assertThat(r.status()).isEqualTo(201);
      String message = member.messages.poll(10, TimeUnit.SECONDS);
      assertThat(message).contains("notification.created");
      assertThat(admin.messages.poll(1500, TimeUnit.MILLISECONDS)).isNull();
    }
  }
}
