package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.Permissions;
import com.taskflow.workspace.WorkspaceQuery;
import java.sql.Connection;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DeadlockLoserDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

@DisplayName("DEP-1 a lock wait or deadlock is 409 dependency.busy, never 500")
class DependencyBusyIT extends DependencyTestBase {

  @Autowired DataSource dataSource;

  private int records(String key) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM idempotency_record WHERE key = ?", Integer.class, key);
  }

  @Test
  void aHeldRowLockAnswers409BusyStoresNothingAndTheSameKeySucceedsAfterRelease() throws Exception {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, f.list(), "B");
    String key = "busy-" + UUID.randomUUID();
    long va = version(m, a);
    Map<String, Object> body = Map.of("otherTaskId", b, "relation", "WAITING_ON");
    int outbox = outbox(f.ws().id());

    try (Connection holder = dataSource.getConnection()) {
      holder.setAutoCommit(false);
      try (var st = holder.prepareStatement("SELECT id FROM task WHERE id = ? FOR UPDATE")) {
        st.setObject(1, b);
        st.executeQuery();
      }
      Resp busy =
          post(
              "/api/v1/tasks/" + a + "/dependencies",
              m.token(),
              body,
              "If-Match",
              "\"" + va + "\"",
              "Idempotency-Key",
              key);
      assertThat(busy.status()).as(busy.raw()).isEqualTo(409);
      assertThat(busy.at("/code").asText()).isEqualTo("dependency.busy");
      assertThat(count("task_dependency", f.ws().id())).isZero();
      assertThat(outbox(f.ws().id())).isEqualTo(outbox);
      assertThat(records(key)).isZero();
      holder.rollback();
    }
    Resp ok =
        post(
            "/api/v1/tasks/" + a + "/dependencies",
            m.token(),
            body,
            "If-Match",
            "\"" + va + "\"",
            "Idempotency-Key",
            key);
    assertThat(ok.status()).as(ok.raw()).isEqualTo(201);
    assertThat(records(key)).isEqualTo(1);

    // the same for a remove
    UUID dep = ok.uuid("/dependency/id");
    long vb = version(m, a);
    try (Connection holder = dataSource.getConnection()) {
      holder.setAutoCommit(false);
      try (var st = holder.prepareStatement("SELECT id FROM task WHERE id = ? FOR UPDATE")) {
        st.setObject(1, b);
        st.executeQuery();
      }
      Resp busy =
          delete(
              "/api/v1/tasks/" + a + "/dependencies/" + dep,
              m.token(),
              "If-Match",
              "\"" + vb + "\"");
      assertThat(busy.status()).isEqualTo(409);
      assertThat(busy.at("/code").asText()).isEqualTo("dependency.busy");
      holder.rollback();
    }
    assertThat(count("task_dependency", f.ws().id())).isEqualTo(1);
    assertThat(unrelate(m, a, dep).status()).isEqualTo(204);
  }

  @Test
  void aDeadlockLoserIsTranslatedTheSameWay() {
    TaskRepository repo = mock(TaskRepository.class);
    TaskRepository.Row row =
        new TaskRepository.Row(
            UUID.randomUUID(),
            UUID.randomUUID(),
            "TF",
            UUID.randomUUID(),
            null,
            UUID.randomUUID(),
            1,
            "T",
            null,
            com.taskflow.task.Priority.NONE,
            null,
            null,
            "a",
            1,
            UUID.randomUUID(),
            Instant.EPOCH,
            Instant.EPOCH,
            null,
            null,
            new ObjectMapper().createObjectNode(),
            0);
    when(repo.live(any())).thenReturn(row);
    when(repo.find(any())).thenReturn(Optional.of(row));
    DependencyLock lock = mock(DependencyLock.class);
    doThrow(new DeadlockLoserDataAccessException("deadlock detected", null)).when(lock).lock(any());
    DependencyService service =
        new DependencyService(
            mock(JdbcTemplate.class),
            mock(NamedParameterJdbcTemplate.class),
            repo,
            mock(TaskService.class),
            lock,
            mock(EventRecorder.class),
            mock(Permissions.class),
            mock(WorkspaceQuery.class));
    assertThatThrownBy(() ->
            service.add(row.id(), 1, UUID.randomUUID(), DependencyService.Relation.WAITING_ON))
        .isInstanceOfSatisfying(
            TaskflowException.class,
            e -> {
              assertThat(e.code()).isEqualTo("dependency.busy");
              assertThat(e.status().value()).isEqualTo(409);
            });
  }
}
