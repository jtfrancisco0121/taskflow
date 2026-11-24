package com.taskflow.shared.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.taskflow.IntegrationTest;
import com.taskflow.shared.TaskflowException;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.IllegalTransactionStateException;

@DisplayName("CAP-22 atomic outbox and activity events")
class EventRecorderIT extends IntegrationTest {

  @Autowired ProbeService probe;

  private int count(String table, UUID workspaceId) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM " + table + " WHERE workspace_id = ?", Integer.class, workspaceId);
  }

  @Test
  void recordingWithoutATransactionThrows() {
    assertThatThrownBy(() -> probe.writeWithoutTransaction(UUID.randomUUID()))
        .isInstanceOf(IllegalTransactionStateException.class);
  }

  @Test
  void aCommittedWriteLeavesExactlyOneRowInEachTable() {
    UUID workspace = UUID.randomUUID();
    UUID id = probe.write(workspace, "ok", false);
    assertThat(count("outbox_event", workspace)).isEqualTo(1);
    assertThat(count("activity_event", workspace)).isEqualTo(1);
    assertThat(
            jdbc.queryForObject("SELECT count(*) FROM idem_effect WHERE id = ?", Integer.class, id))
        .isEqualTo(1);
  }

  @Test
  void aRolledBackWriteLeavesNoChangeAndNoEvents() {
    UUID workspace = UUID.randomUUID();
    assertThatThrownBy(() -> probe.write(workspace, "boom-" + workspace, true))
        .isInstanceOf(TaskflowException.class);
    assertThat(count("outbox_event", workspace)).isZero();
    assertThat(count("activity_event", workspace)).isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM idem_effect WHERE name = ?",
                Integer.class,
                "boom-" + workspace))
        .isZero();
  }
}
