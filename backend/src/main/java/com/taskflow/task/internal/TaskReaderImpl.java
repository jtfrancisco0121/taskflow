package com.taskflow.task.internal;

import com.taskflow.task.TaskReader;
import com.taskflow.task.TaskView;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
class TaskReaderImpl implements TaskReader {

  private final TaskRepository repo;
  private final NamedParameterJdbcTemplate named;

  TaskReaderImpl(TaskRepository repo, NamedParameterJdbcTemplate named) {
    this.repo = repo;
    this.named = named;
  }

  @Override
  @Transactional(readOnly = true)
  public List<TaskView> views(List<UUID> ids) {
    if (ids.isEmpty()) {
      return List.of();
    }
    List<TaskRepository.Row> rows =
        named.query(
            TaskRepository.SELECT + " WHERE t.id IN (:ids) AND t.deleted_at IS NULL",
            new MapSqlParameterSource("ids", ids),
            repo.rowMapper());
    Map<UUID, TaskView> byId = new HashMap<>();
    for (TaskView v : repo.views(rows)) {
      byId.put(v.id(), v);
    }
    return ids.stream().map(byId::get).filter(Objects::nonNull).toList();
  }
}
