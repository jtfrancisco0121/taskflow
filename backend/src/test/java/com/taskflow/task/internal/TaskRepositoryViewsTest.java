package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.field.FieldCatalog;
import com.taskflow.field.FieldInfo;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

@DisplayName("FIELD-3 / AD-13 effective fields are resolved once per List")
class TaskRepositoryViewsTest {

  private static final ObjectMapper M = new ObjectMapper();

  private static TaskRepository.Row row(UUID listId, long number) {
    return new TaskRepository.Row(
        UUID.randomUUID(),
        UUID.randomUUID(),
        "TF",
        listId,
        null,
        UUID.randomUUID(),
        number,
        "T" + number,
        null,
        null,
        null,
        null,
        "a",
        1,
        UUID.randomUUID(),
        Instant.EPOCH,
        Instant.EPOCH,
        null,
        null,
        M.createObjectNode(),
        0);
  }

  @Test
  void fiftyTasksOfTwoListsResolveTheEffectiveSetTwice() {
    FieldCatalog catalog = mock(FieldCatalog.class);
    when(catalog.effective(any())).thenReturn(List.<FieldInfo>of());
    TaskRepository repo = new TaskRepository(mock(JdbcTemplate.class), M, catalog);
    UUID a = UUID.randomUUID();
    UUID b = UUID.randomUUID();
    List<TaskRepository.Row> rows = new ArrayList<>();
    for (int i = 0; i < 50; i++) {
      rows.add(row(i % 2 == 0 ? a : b, i));
    }

    assertThat(repo.views(rows)).hasSize(50);

    verify(catalog, times(1)).effective(a);
    verify(catalog, times(1)).effective(b);
    verify(catalog, times(2)).effective(any());
  }
}
