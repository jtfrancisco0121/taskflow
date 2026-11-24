package com.taskflow.shared.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import com.taskflow.shared.Actor;
import com.taskflow.shared.EventRecorder;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.RabbitMQContainer;

/**
 * Its own Spring context, so its own RabbitMQ container (the property makes the context key
 * unique): pausing the broker here never touches another test.
 */
@DisplayName("AD-2 a paused broker does not slow the Redis relay")
@TestPropertySource(
    properties = {
      "taskflow.outbox.enabled=true",
      "taskflow.outbox.amqp.enabled=true",
      "taskflow.test.outage=true"
    })
class AmqpOutboxOutageIT extends IntegrationTest {

  @Autowired RabbitMQContainer broker;
  @Autowired EventRecorder events;
  @Autowired TransactionTemplate tx;

  private List<UUID> record(int n) {
    List<UUID> entities = new ArrayList<>();
    UUID workspace = UUID.randomUUID();
    tx.executeWithoutResult(s -> {
      for (int i = 0; i < n; i++) {
        UUID e = UUID.randomUUID();
        entities.add(e);
        events.record(workspace, "task", e, "task.updated", Map.of("v", i), Actor.SYSTEM);
      }
    });
    return entities;
  }

  private long count(String where, List<UUID> entities) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM outbox_event WHERE entity_id = ANY (?::uuid[]) AND " + where,
        Long.class,
        (Object) entities.toArray(new UUID[0]));
  }

  @Test
  void redisKeepsItsLatencyWhileTheBrokerIsPausedAndRowsAreQueuedAfterwards() throws Exception {
    var docker = DockerClientFactory.instance().client();
    docker.pauseContainerCmd(broker.getContainerId()).exec();
    try {
      long start = System.currentTimeMillis();
      List<UUID> entities = record(20);
      while (count("published_at IS NOT NULL", entities) < 20
          && System.currentTimeMillis() - start < 3000) {
        Thread.sleep(20);
      }
      assertThat(count("published_at IS NOT NULL", entities)).isEqualTo(20);
      assertThat(System.currentTimeMillis() - start).isLessThan(1000);
      assertThat(count("queued_at IS NULL", entities)).isEqualTo(20);
    } finally {
      docker.unpauseContainerCmd(broker.getContainerId()).exec();
    }
    List<UUID> later = record(5);
    long deadline = System.currentTimeMillis() + 45000;
    while (System.currentTimeMillis() < deadline && count("queued_at IS NOT NULL", later) < 5) {
      Thread.sleep(200);
    }
    assertThat(count("queued_at IS NOT NULL", later)).isEqualTo(5);
  }
}
