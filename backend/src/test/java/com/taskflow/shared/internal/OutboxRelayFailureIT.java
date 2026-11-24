package com.taskflow.shared.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.taskflow.IntegrationTest;
import com.taskflow.shared.Actor;
import com.taskflow.shared.EventRecorder;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.transaction.support.TransactionTemplate;

@DisplayName("RT-1 relay failure keeps the row unpublished")
class OutboxRelayFailureIT extends IntegrationTest {

  @Autowired EventRecorder events;
  @Autowired TransactionTemplate tx;

  @Test
  void aFailureToPublishLeavesPublishedAtNull() {
    UUID workspace = UUID.randomUUID();
    UUID entity = UUID.randomUUID();
    tx.executeWithoutResult(s ->
        events.record(
            workspace, "task", entity, "task.updated", Map.of("version", 2), Actor.SYSTEM));
    StringRedisTemplate broken = mock(StringRedisTemplate.class);
    when(broken.convertAndSend(anyString(), anyString()))
        .thenThrow(new RedisConnectionFailureException("down"));
    tx.executeWithoutResult(x -> new OutboxRelay(jdbc, broken, mapper).relay());
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM outbox_event WHERE entity_id = ? AND published_at IS NULL",
                Integer.class,
                entity))
        .isEqualTo(1);
  }
}
