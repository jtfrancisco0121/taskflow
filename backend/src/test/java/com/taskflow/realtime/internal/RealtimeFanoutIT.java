package com.taskflow.realtime.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.TaskflowApplication;
import com.taskflow.TestcontainersConfiguration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.TestPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Two application instances share one Postgres and one Redis. Instance A (this test's context) runs
 * the relay and serves REST; clients connect to instance B's STOMP endpoint.
 */
@DisplayName("RT-1 fan-out across instances and Locations")
@TestPropertySource(properties = "taskflow.outbox.enabled=true")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class RealtimeFanoutIT extends StompTestSupport {

  @Autowired PostgreSQLContainer<?> postgres;

  @Autowired
  @Qualifier("redisContainer")
  GenericContainer<?> redisContainer;

  private ConfigurableApplicationContext instanceB;
  private int portB;

  @BeforeAll
  void startSecondInstance() {
    // Program arguments outrank application.yml, which would otherwise win over default properties.
    instanceB =
        new SpringApplicationBuilder(TaskflowApplication.class)
            .run(
                "--server.port=0",
                "--spring.datasource.url=" + postgres.getJdbcUrl(),
                "--spring.datasource.username=" + postgres.getUsername(),
                "--spring.datasource.password=" + postgres.getPassword(),
                "--spring.data.redis.host=" + redisContainer.getHost(),
                "--spring.data.redis.port=" + redisContainer.getMappedPort(6379),
                "--taskflow.jwt.secret=" + TestcontainersConfiguration.JWT_SECRET,
                "--taskflow.purge.enabled=false",
                "--taskflow.outbox.enabled=false",
                "--spring.main.banner-mode=off");
    portB = ((WebServerApplicationContext) instanceB).getWebServer().getPort();
  }

  @AfterAll
  void stopSecondInstance() {
    if (instanceB != null) {
      instanceB.close();
    }
  }

  private record Fix(
      Ws ws, UUID space, UUID list, UUID otherSpace, UUID otherList, UUID privateList) {}

  private Fix fixture() {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    UUID list = list(ws.member(), space, "L");
    UUID otherSpace = space(ws.owner(), ws.id(), "Other");
    UUID otherList = list(ws.member(), otherSpace, "OL");
    UUID secret = list(ws.owner(), space, "Secret");
    patch("/api/v1/locations/" + secret, ws.owner().token(), Map.of("isPrivate", true));
    relayIdle(ws.id());
    return new Fix(ws, space, list, otherSpace, otherList, secret);
  }

  /** Waits until the relay has published the set-up events, so they cannot arrive mid-test. */
  private void relayIdle(UUID workspace) {
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
      try {
        Thread.sleep(50);
      } catch (InterruptedException e) {
        throw new IllegalStateException(e);
      }
    }
    try {
      Thread.sleep(400);
    } catch (InterruptedException e) {
      throw new IllegalStateException(e);
    }
  }

  private JsonNode next(Conn c, long millis) throws Exception {
    String raw = c.messages.poll(millis, TimeUnit.MILLISECONDS);
    return raw == null ? null : mapper.readTree(raw);
  }

  private void update(TestUser user, UUID task, long version, String title) {
    assertThat(patchTask(user, task, version, Map.of("title", title)).status()).isEqualTo(200);
  }

  @Test
  void aChangeThroughInstanceAReachesAClientOnInstanceB() throws Exception {
    Fix f = fixture();
    UUID task = task(f.ws().member(), f.list(), "Secret title");
    relayIdle(f.ws().id());
    try (Conn c = connect(portB, f.ws().member().token())) {
      assertThat(c.isConnected()).isTrue();
      c.subscribe("/topic/location/" + f.list());
      c.subscribe("/topic/workspace/" + f.ws().id());
      c.subscribe("/topic/task/" + task);
      Thread.sleep(300);
      update(f.ws().member(), task, 1, "Renamed body text");
      JsonNode m = next(c, 3000);
      assertThat(m).isNotNull();
      assertThat(m.get("type").asText()).isEqualTo("task.updated");
      assertThat(m.get("entityId").asText()).isEqualTo(task.toString());
      assertThat(m.get("version").asLong()).isEqualTo(2);
      assertThat(m.get("listId").asText()).isEqualTo(f.list().toString());
      // ids, type and version only: no title, description or other task content
      List<String> keys = new ArrayList<>();
      m.fieldNames().forEachRemaining(keys::add);
      assertThat(keys)
          .containsExactlyInAnyOrder(
              "type", "entity", "entityId", "version", "listId", "clientId", "occurredAt");
      assertThat(m.toString()).doesNotContain("Renamed").doesNotContain("Secret title");
    }
  }

  @Test
  void anEventInAPrivateListNeverReachesTheSpaceOrWorkspaceTopics() throws Exception {
    Fix f = fixture();
    UUID hidden = task(f.ws().owner(), f.privateList(), "hidden");
    relayIdle(f.ws().id());
    try (Conn watcher = connect(portB, f.ws().member().token());
        Conn owner = connect(portB, f.ws().owner().token())) {
      watcher.subscribe("/topic/location/" + f.space());
      watcher.subscribe("/topic/workspace/" + f.ws().id());
      owner.subscribe("/topic/location/" + f.privateList());
      Thread.sleep(300);
      update(f.ws().owner(), hidden, 1, "hidden 2");
      JsonNode atOwner = next(owner, 3000);
      assertThat(atOwner).isNotNull();
      assertThat(atOwner.get("entityId").asText()).isEqualTo(hidden.toString());
      assertThat(next(watcher, 1500)).isNull();
    }
  }

  @Test
  void aGuestWithOneListGrantReceivesNothingFromAnotherSpace() throws Exception {
    Fix f = fixture();
    put(
        "/api/v1/locations/" + f.list() + "/grants/" + f.ws().guest().id(),
        f.ws().owner().token(),
        null);
    UUID inGranted = task(f.ws().member(), f.list(), "g");
    UUID inOther = task(f.ws().member(), f.otherList(), "o");
    relayIdle(f.ws().id());
    try (Conn guest = connect(portB, f.ws().guest().token())) {
      guest.subscribe("/topic/location/" + f.list());
      Thread.sleep(300);
      update(f.ws().member(), inOther, 1, "o2");
      assertThat(next(guest, 1500)).isNull();
      update(f.ws().member(), inGranted, 1, "g2");
      JsonNode m = next(guest, 3000);
      assertThat(m).isNotNull();
      assertThat(m.get("entityId").asText()).isEqualTo(inGranted.toString());
    }
  }

  @Test
  void aLocationRenameReachesTheParentAndTheWorkspace() throws Exception {
    Fix f = fixture();
    UUID folder = folder(f.ws().owner(), f.space(), "F");
    relayIdle(f.ws().id());
    try (Conn c = connect(portB, f.ws().member().token())) {
      c.subscribe("/topic/location/" + f.space());
      c.subscribe("/topic/workspace/" + f.ws().id());
      Thread.sleep(300);
      assertThat(
              patch("/api/v1/locations/" + folder, f.ws().owner().token(), Map.of("name", "F2"))
                  .status())
          .isEqualTo(200);
      JsonNode m = next(c, 3000);
      assertThat(m).isNotNull();
      assertThat(m.get("type").asText()).isEqualTo("location.renamed");
      assertThat(m.get("entityId").asText()).isEqualTo(folder.toString());
      // delivered once per matching topic: the Space topic and the workspace topic
      JsonNode second = next(c, 1500);
      assertThat(second).isNotNull();
    }
  }

  @Test
  void aTaskMovedBetweenListsNotifiesBothAndTheClientIdTravels() throws Exception {
    Fix f = fixture();
    UUID task = task(f.ws().member(), f.list(), "t");
    UUID clientId = UUID.randomUUID();
    relayIdle(f.ws().id());
    try (Conn c = connect(portB, f.ws().member().token())) {
      c.subscribe("/topic/location/" + f.otherList());
      Thread.sleep(300);
      Resp r =
          post(
              "/api/v1/tasks/" + task + "/move",
              f.ws().member().token(),
              Map.of("listId", f.otherList()),
              "If-Match",
              "\"1\"",
              "X-Client-Id",
              clientId.toString());
      assertThat(r.status()).isEqualTo(200);
      JsonNode m = next(c, 3000);
      assertThat(m).isNotNull();
      assertThat(m.get("type").asText()).isEqualTo("task.moved");
      assertThat(m.get("listId").asText()).isEqualTo(f.otherList().toString());
      assertThat(m.get("clientId").asText()).isEqualTo(clientId.toString());
    }
  }
}
