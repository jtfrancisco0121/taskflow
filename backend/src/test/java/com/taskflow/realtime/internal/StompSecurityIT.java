package com.taskflow.realtime.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("RT-1 STOMP authentication and subscription checks")
@org.springframework.test.context.TestPropertySource(
    properties = "taskflow.realtime.session-sweep-ms=300")
class StompSecurityIT extends StompTestSupport {

  private record Fix(Ws ws, UUID space, UUID list, UUID privateList, UUID task) {}

  private Fix fixture() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    UUID secret = list(ws.owner(), space, "Secret");
    patch("/api/v1/locations/" + secret, ws.owner().token(), Map.of("isPrivate", true));
    UUID task = task(ws.member(), list, "T");
    return new Fix(ws, space, list, secret, task);
  }

  private void expectRefused(String token, String destination) throws Exception {
    try (Conn c = connect(port, token)) {
      assertThat(c.isConnected()).isTrue();
      c.subscribe(destination);
      assertThat(c.awaitError(3000)).as("ERROR for " + destination).isNotNull();
    }
  }

  @Test
  void aConnectWithoutAValidTokenIsRefused() throws Exception {
    Fix f = fixture();
    try (Conn none = connect(port, null)) {
      assertThat(none.isConnected()).isFalse();
      assertThat(none.awaitError(3000)).isNotNull();
    }
    try (Conn expired = connect(port, expiredToken(f.ws().member().id()))) {
      assertThat(expired.isConnected()).isFalse();
      assertThat(expired.awaitError(3000)).isNotNull();
    }
    try (Conn junk = connect(port, "not.a.token")) {
      assertThat(junk.isConnected()).isFalse();
    }
    try (Conn ok = connect(port, f.ws().member().token())) {
      assertThat(ok.isConnected()).isTrue();
      ok.subscribe("/topic/location/" + f.list());
      ok.subscribe("/topic/task/" + f.task());
      ok.subscribe("/topic/task/" + f.task() + "/presence");
      ok.subscribe("/topic/workspace/" + f.ws().id());
      assertThat(ok.awaitError(800)).isNull();
    }
  }

  @Test
  void theSessionIsClosedWhenTheAccessTokenExpires() throws Exception {
    Fix f = fixture();
    try (Conn c = connect(port, tokenExpiringIn(f.ws().member().id(), 2))) {
      assertThat(c.isConnected()).isTrue();
      long deadline = System.currentTimeMillis() + 6000;
      while (c.isConnected() && System.currentTimeMillis() < deadline) {
        Thread.sleep(100);
      }
      assertThat(c.isConnected()).isFalse();
    }
  }

  @Test
  void aSubscribeToWhatTheUserCannotSeeIsAnError() throws Exception {
    Fix f = fixture();
    expectRefused(f.ws().member().token(), "/topic/location/" + f.privateList());
    expectRefused(f.ws().member().token(), "/topic/location/" + UUID.randomUUID());
    expectRefused(f.ws().member().token(), "/topic/workspace/" + UUID.randomUUID());
    UUID secretTask = task(f.ws().owner(), f.privateList(), "hidden");
    expectRefused(f.ws().member().token(), "/topic/task/" + secretTask);
    TestUser outsider = signUp("Outsider");
    expectRefused(outsider.token(), "/topic/location/" + f.list());
  }

  @Test
  void aGuestWithOneListGrantCannotUseTheWorkspaceTopicButGetsItsGrantedList() throws Exception {
    Fix f = fixture();
    put(
        "/api/v1/locations/" + f.list() + "/grants/" + f.ws().guest().id(),
        f.ws().owner().token(),
        null);
    expectRefused(f.ws().guest().token(), "/topic/workspace/" + f.ws().id());
    try (Conn c = connect(port, f.ws().guest().token())) {
      c.subscribe("/topic/location/" + f.list());
      assertThat(c.awaitError(800)).isNull();
    }
    UUID other = list(f.ws().owner(), space(f.ws().owner(), f.ws().id(), "Other"), "O");
    expectRefused(f.ws().guest().token(), "/topic/location/" + other);
  }

  @Test
  void interleavedSubscribesOfTwoUsersAreEachCheckedWithTheirOwnIdentity() throws Exception {
    Fix f = fixture();
    List<CompletableFuture<Boolean>> results = new ArrayList<>();
    try (Conn owner = connect(port, f.ws().owner().token());
        Conn member = connect(port, f.ws().member().token())) {
      for (int i = 0; i < 15; i++) {
        owner.subscribe("/topic/location/" + f.privateList());
        member.subscribe("/topic/location/" + f.privateList());
      }
      Thread.sleep(1500);
      // the member got an ERROR for the private list; the owner never did
      assertThat(owner.errors).isEmpty();
      assertThat(member.errors).isNotEmpty();
    }
  }

  @Test
  void aClientCannotSendToTopicsOrOtherDestinations() throws Exception {
    Fix f = fixture();
    try (Conn listener = connect(port, f.ws().owner().token());
        Conn sender = connect(port, f.ws().member().token())) {
      listener.subscribe("/topic/workspace/" + f.ws().id());
      listener.subscribe("/topic/location/" + f.list());
      listener.subscribe("/topic/task/" + f.task() + "/presence");
      Thread.sleep(500);
      for (String destination :
          List.of(
              "/topic/workspace/" + f.ws().id(),
              "/topic/location/" + f.list(),
              "/topic/task/" + f.task() + "/presence",
              "/app/other",
              "/topic/x")) {
        try (Conn s = connect(port, f.ws().member().token())) {
          s.session.send(destination, "{\"fake\":true}");
          assertThat(s.awaitError(3000)).as("SEND " + destination).isNotNull();
        }
      }
      Thread.sleep(500);
      assertThat(listener.messages).isEmpty();
      assertThat(sender.isConnected()).isTrue();
    }
  }

  @Test
  void unknownDestinationsAndMalformedIdsAreRefused() throws Exception {
    Fix f = fixture();
    String t = f.ws().member().token();
    expectRefused(t, "/topic/x");
    expectRefused(t, "/app/presence/" + f.task());
    expectRefused(t, "/topic/location/not-a-uuid");
    expectRefused(t, "/queue/anything");
    expectRefused(t, "/topic/task/" + f.task() + "/presence/extra");
  }

  @Test
  void aPresenceHeartbeatForAViewableTaskIsAcceptedAndOthersAreNot() throws Exception {
    Fix f = fixture();
    UUID secretTask = task(f.ws().owner(), f.privateList(), "hidden");
    try (Conn c = connect(port, f.ws().member().token())) {
      c.session.send("/app/presence/" + f.task(), "");
      assertThat(c.awaitError(800)).isNull();
    }
    try (Conn c = connect(port, f.ws().member().token())) {
      c.session.send("/app/presence/" + secretTask, "");
      assertThat(c.awaitError(3000)).isNotNull();
    }
  }
}
