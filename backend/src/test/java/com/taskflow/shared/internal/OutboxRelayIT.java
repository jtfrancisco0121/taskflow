package com.taskflow.shared.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.IntegrationTest;
import com.taskflow.shared.Actor;
import com.taskflow.shared.EventRecorder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.support.TransactionTemplate;

@DisplayName("RT-1 outbox relay to Redis")
@TestPropertySource(properties = "taskflow.outbox.enabled=true")
class OutboxRelayIT extends IntegrationTest {

  @Autowired RedisConnectionFactory redisFactory;
  @Autowired StringRedisTemplate redis;
  @Autowired EventRecorder events;
  @Autowired TransactionTemplate tx;

  private RedisMessageListenerContainer listener;
  private final List<JsonNode> received = new CopyOnWriteArrayList<>();

  @BeforeEach
  void subscribe() throws Exception {
    listener = new RedisMessageListenerContainer();
    listener.setConnectionFactory(redisFactory);
    listener.afterPropertiesSet();
    listener.start();
    listener.addMessageListener(
        (message, pattern) -> {
          try {
            received.add(mapper.readTree(new String(message.getBody(), StandardCharsets.UTF_8)));
          } catch (Exception e) {
            throw new IllegalStateException(e);
          }
        },
        new ChannelTopic(OutboxRelay.CHANNEL));
    // let the subscription settle before the first publish
    Thread.sleep(300);
  }

  @AfterEach
  void stop() throws Exception {
    listener.stop();
    listener.destroy();
  }

  private JsonNode await(java.util.function.Predicate<JsonNode> match) throws Exception {
    long deadline = System.currentTimeMillis() + Duration.ofSeconds(5).toMillis();
    while (System.currentTimeMillis() < deadline) {
      for (JsonNode n : received) {
        if (match.test(n)) {
          return n;
        }
      }
      Thread.sleep(50);
    }
    throw new AssertionError("no matching event within 5 s; got " + received.size());
  }

  @Test
  void aCommittedTaskChangeIsPublishedWithinASecondWithVersionListIdAndClientId() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID list = list(ws.member(), space(ws.owner(), ws.id(), "S"), "L");
    UUID task = task(ws.member(), list, "T");
    UUID clientId = UUID.randomUUID();
    long start = System.currentTimeMillis();
    Resp r =
        patch(
            "/api/v1/tasks/" + task,
            ws.member().token(),
            Map.of("title", "Renamed"),
            "If-Match",
            "\"1\"",
            "X-Client-Id",
            clientId.toString());
    assertThat(r.status()).isEqualTo(200);
    JsonNode event =
        await(n ->
            n.get("entityId").asText().equals(task.toString())
                && n.get("type").asText().equals("task.updated"));
    assertThat(System.currentTimeMillis() - start).isLessThan(1000);
    assertThat(event.at("/payload/version").asLong()).isEqualTo(2);
    assertThat(event.at("/payload/listId").asText()).isEqualTo(list.toString());
    assertThat(event.at("/payload/clientId").asText()).isEqualTo(clientId.toString());
    assertThat(event.get("workspaceId").asText()).isEqualTo(ws.id().toString());
    assertThat(event.get("actorId").asText()).isEqualTo(ws.member().id().toString());
    // the activity feed never carries the tab id
    assertThat(
            jdbc.queryForObject(
                "SELECT payload::text FROM activity_event WHERE entity_id = ? AND type ="
                    + " 'task.updated'",
                String.class,
                task))
        .doesNotContain("clientId");
    Resp activity = get("/api/v1/tasks/" + task + "/activity", ws.member().token());
    assertThat(activity.raw()).doesNotContain(clientId.toString());
  }

  @Test
  void aRolledBackChangeIsNeverPublished() throws Exception {
    UUID workspace = UUID.randomUUID();
    UUID entity = UUID.randomUUID();
    tx.executeWithoutResult(status -> {
      events.record(workspace, "task", entity, "task.updated", Map.of("version", 9), Actor.SYSTEM);
      status.setRollbackOnly();
    });
    Thread.sleep(800);
    assertThat(received.stream().filter(n -> n.get("entityId").asText().equals(entity.toString())))
        .isEmpty();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE entity_id = ?", Integer.class, entity))
        .isZero();
  }

  @Test
  void twoRelaysPublishEachRowOnce() throws Exception {
    UUID workspace = UUID.randomUUID();
    int rows = 300;
    tx.executeWithoutResult(status -> {
      for (int i = 0; i < rows; i++) {
        events.record(
            workspace,
            "task",
            UUID.randomUUID(),
            "task.updated",
            Map.of("version", i),
            Actor.SYSTEM);
      }
    });
    OutboxRelay a = new OutboxRelay(jdbc, redis, mapper);
    OutboxRelay b = new OutboxRelay(jdbc, redis, mapper);
    Thread t1 = new Thread(() -> tx.executeWithoutResult(x -> a.relay()));
    Thread t2 = new Thread(() -> tx.executeWithoutResult(x -> b.relay()));
    t1.start();
    t2.start();
    t1.join();
    t2.join();
    long deadline = System.currentTimeMillis() + 5000;
    while (countFor(workspace) < rows && System.currentTimeMillis() < deadline) {
      Thread.sleep(50);
    }
    Thread.sleep(500);
    assertThat(countFor(workspace)).isEqualTo(rows);
    assertThat(
            received.stream()
                .filter(n -> n.get("workspaceId").asText().equals(workspace.toString()))
                .map(n -> n.get("id").asText())
                .distinct())
        .hasSize(rows);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE workspace_id = ? AND published_at IS NULL",
                Integer.class,
                workspace))
        .isZero();
  }

  private long countFor(UUID workspace) {
    return received.stream()
        .filter(n -> n.get("workspaceId").asText().equals(workspace.toString()))
        .count();
  }

  @Test
  void rowsFromBeforePhase2AreMarkedPublishedByTheMigration() throws Exception {
    UUID workspace = UUID.randomUUID();
    // a relay-less insert: pretend an old row that the relay has not seen
    jdbc.update(
        "INSERT INTO outbox_event (id, workspace_id, entity, entity_id, type, payload, actor_type,"
            + " actor_id, created_at) VALUES (?, ?, 'task', ?, 'task.created', '{}'::jsonb, 'USER', ?,"
            + " now() - interval '3 days')",
        UUID.randomUUID(),
        workspace,
        UUID.randomUUID(),
        UUID.randomUUID());
    String sql =
        new String(
            new org.springframework.core.io.ClassPathResource(
                    "db/migration/V202611250930__shared_outbox_mark_phase1_published.sql")
                .getInputStream()
                .readAllBytes(),
            StandardCharsets.UTF_8);
    jdbc.execute(sql);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE workspace_id = ? AND published_at IS NOT NULL"
                    + " AND published_at = created_at",
                Integer.class,
                workspace))
        .isEqualTo(1);
  }
}
