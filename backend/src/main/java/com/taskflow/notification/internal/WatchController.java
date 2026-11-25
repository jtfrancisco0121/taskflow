package com.taskflow.notification.internal;

import com.taskflow.identity.UserDirectory;
import com.taskflow.identity.UserInfo;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.TaskflowException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Who watches a task, and the caller's own watch switch (CAP-10). */
@RestController
@RequestMapping("/api/v1")
class WatchController {

  record Watcher(UUID userId, String displayName) {}

  record WatchView(boolean watching, int count, List<Watcher> items) {}

  private final JdbcTemplate jdbc;
  private final UserDirectory users;
  private final NotificationProcessor processor;

  WatchController(JdbcTemplate jdbc, UserDirectory users, NotificationProcessor processor) {
    this.jdbc = jdbc;
    this.users = users;
    this.processor = processor;
  }

  @GetMapping("/tasks/{id}/watchers")
  @PreAuthorize("hasPermission(#id, 'TASK', 'VIEW')")
  @Transactional(readOnly = true)
  public WatchView watchers(@PathVariable UUID id) {
    return view(id);
  }

  @PutMapping("/tasks/{id}/watch")
  @PreAuthorize("hasPermission(#id, 'TASK', 'VIEW')")
  @Transactional
  public WatchView watch(@PathVariable UUID id) {
    return set(id, true);
  }

  @DeleteMapping("/tasks/{id}/watch")
  @PreAuthorize("hasPermission(#id, 'TASK', 'VIEW')")
  @Transactional
  public WatchView unwatch(@PathVariable UUID id) {
    return set(id, false);
  }

  private WatchView set(UUID taskId, boolean watching) {
    UUID me = CurrentActor.userId();
    if (users.byId(me).map(UserInfo::email).isEmpty()) {
      throw TaskflowException.forbidden("notification.not_a_person", "Only people can watch tasks");
    }
    UUID workspaceId =
        jdbc.queryForObject("SELECT workspace_id FROM task WHERE id = ?", UUID.class, taskId);
    processor.watch(workspaceId, taskId, me, watching);
    return view(taskId);
  }

  private WatchView view(UUID taskId) {
    UUID me = CurrentActor.userId();
    List<UUID> ids =
        jdbc.queryForList(
            "SELECT user_id FROM task_watcher WHERE task_id = ? AND watching ORDER BY updated_at,"
                + " user_id",
            UUID.class,
            taskId);
    Map<UUID, UserInfo> names = users.byIds(ids);
    List<Watcher> items =
        ids.stream()
            .map(id ->
                new Watcher(id, names.containsKey(id) ? names.get(id).displayName() : "Unknown"))
            .toList();
    return new WatchView(ids.contains(me), ids.size(), items);
  }
}
