package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@DisplayName("RT-3 the purge path records events without a client id")
class TaskPurgeEventsIT extends TaskTestBase {

  @Autowired TaskPurgeService purge;

  @Test
  void theNightlyPurgeCommitsItsEventsWithVersionListIdAndNoClientId() throws Exception {
    Fix f = fixture();
    UUID t = task(f.ws().member(), f.list(), "Old");
    assertThat(trash(f.ws().member(), t, 1).status()).isEqualTo(204);
    jdbc.update("UPDATE task SET deleted_at = now() - interval '40 days' WHERE id = ?", t);
    assertThat(purge.purge(Instant.now())).isGreaterThanOrEqualTo(1);
    JsonNode payload =
        mapper.readTree(
            jdbc.queryForObject(
                "SELECT payload::text FROM outbox_event WHERE entity_id = ? AND type = 'task.purged'",
                String.class,
                t));
    assertThat(payload.get("listId").asText()).isEqualTo(f.list().toString());
    assertThat(payload.hasNonNull("version")).isTrue();
    assertThat(payload.has("clientId")).isFalse();
  }
}
