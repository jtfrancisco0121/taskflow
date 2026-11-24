package com.taskflow.shared.internal;

import com.taskflow.shared.Actor;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.Ids;
import com.taskflow.shared.TaskflowException;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Test-only transactional bean used by EventRecorderIT and IdempotencyIT. */
@Service
class ProbeService {

  private final JdbcTemplate jdbc;
  private final EventRecorder events;

  ProbeService(JdbcTemplate jdbc, EventRecorder events) {
    this.jdbc = jdbc;
    this.events = events;
  }

  @Transactional
  public UUID write(UUID workspaceId, String name, boolean fail) {
    UUID id = Ids.newId();
    jdbc.update("INSERT INTO idem_effect (id, name) VALUES (?, ?)", id, name);
    events.record(workspaceId, "probe", id, "probe.created", Map.of("name", name), Actor.user(id));
    if (fail) {
      throw TaskflowException.conflict("probe.failed", "probe failed on purpose");
    }
    return id;
  }

  public void writeWithoutTransaction(UUID workspaceId) {
    events.record(
        workspaceId, "probe", Ids.newId(), "probe.created", Map.of(), Actor.user(Ids.newId()));
  }
}
