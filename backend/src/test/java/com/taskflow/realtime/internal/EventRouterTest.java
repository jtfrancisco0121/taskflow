package com.taskflow.realtime.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.workspace.LocationTree;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("AD-9 key administration events reach no STOMP topic")
class EventRouterTest {

  private final EventRouter router = new EventRouter(mock(LocationTree.class));
  private final ObjectMapper mapper = new ObjectMapper();

  @Test
  void serviceAccountAndApiKeyEventsAreNotRouted() {
    UUID ws = UUID.randomUUID();
    assertThat(
            router.topics(
                ws,
                "service_account",
                UUID.randomUUID(),
                "service_account.created",
                mapper.createObjectNode()))
        .isEmpty();
    assertThat(
            router.topics(
                ws, "api_key", UUID.randomUUID(), "api_key.revoked", mapper.createObjectNode()))
        .isEmpty();
  }

  @Test
  void otherWorkspaceEntitiesStillGoToTheWorkspaceTopic() {
    UUID ws = UUID.randomUUID();
    assertThat(
            router.topics(
                ws, "member", UUID.randomUUID(), "member.removed", mapper.createObjectNode()))
        .containsExactly("/topic/workspace/" + ws);
  }
}
