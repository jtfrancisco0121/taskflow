package com.taskflow.shared.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import com.taskflow.shared.Actor;
import com.taskflow.shared.EventRecorder;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.support.TransactionTemplate;

@DisplayName("AD-17 the AMQP relay switch")
@TestPropertySource(properties = "taskflow.outbox.amqp.enabled=false")
class AmqpOutboxSwitchIT extends IntegrationTest {

  @Autowired EventRecorder events;
  @Autowired TransactionTemplate tx;
  @Autowired ApplicationContext context;

  @Test
  void withTheSwitchOffNothingIsPublishedOrMarked() throws Exception {
    UUID entity = UUID.randomUUID();
    tx.executeWithoutResult(s ->
        events.record(
            UUID.randomUUID(), "task", entity, "task.updated", Map.of("v", 1), Actor.SYSTEM));
    Thread.sleep(1000);
    assertThat(context.getBeansOfType(AmqpOutboxRelay.class)).isEmpty();
    assertThat(
            jdbc.queryForObject(
                "SELECT queued_at FROM outbox_event WHERE entity_id = ?", Object.class, entity))
        .isNull();
  }
}
