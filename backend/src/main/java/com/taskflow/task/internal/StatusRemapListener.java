package com.taskflow.task.internal;

import com.taskflow.field.StatusCatalog;
import com.taskflow.field.StatusGroup;
import com.taskflow.field.StatusInfo;
import com.taskflow.field.StatusSetChanged;
import com.taskflow.shared.EventRecorder;
import com.taskflow.workspace.LocationMoved;
import com.taskflow.workspace.LocationTree;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Keeps every task's status inside its List's effective set (AD-13): bulk SQL, so each remapped
 * task gets {@code version + 1} and its own {@code task.status_changed} (AD-11).
 */
@Component
class StatusRemapListener {

  private final JdbcTemplate jdbc;
  private final EventRecorder events;
  private final StatusCatalog statuses;
  private final LocationTree tree;

  StatusRemapListener(
      JdbcTemplate jdbc, EventRecorder events, StatusCatalog statuses, LocationTree tree) {
    this.jdbc = jdbc;
    this.events = events;
    this.statuses = statuses;
    this.tree = tree;
  }

  /**
   * A status set was replaced or reset: apply the caller's remap to the tasks using the old ids,
   * but only in the Lists at or under the edited location. A first own set on an inheriting List
   * "removes" every inherited status, so a workspace-wide remap would also re-status the tasks of
   * sibling Lists that still inherit them.
   */
  @EventListener
  void on(StatusSetChanged changed) {
    List<UUID> lists = tree.listIdsAtOrUnder(changed.locationId());
    changed
        .remap()
        .forEach((from, to) -> {
          for (UUID list : lists) {
            remap(changed.workspaceId(), list, from, to, "status_set_changed");
          }
        });
  }

  /** A location moved: tasks whose List left its status scope get the same-group status. */
  @EventListener
  void on(LocationMoved moved) {
    for (UUID list : moved.lists()) {
      Set<UUID> valid = new HashSet<>();
      statuses.effectiveSet(list).forEach(s -> valid.add(s.id()));
      List<UUID> stray =
          jdbc.queryForList(
              "SELECT DISTINCT status_id FROM task WHERE list_id = ?", UUID.class, list);
      for (UUID status : stray) {
        if (valid.contains(status)) {
          continue;
        }
        StatusGroup group =
            statuses.find(status).map(StatusInfo::group).orElse(StatusGroup.NOT_STARTED);
        UUID target =
            statuses
                .sameGroupFirst(list, group)
                .or(() -> statuses.firstNotStarted(list))
                .orElseThrow();
        remap(moved.workspaceId(), list, status, target, "location_moved");
      }
    }
  }

  private void remap(UUID workspaceId, UUID listId, UUID from, UUID to, String cause) {
    List<Map<String, Object>> changed =
        jdbc.queryForList(
            "UPDATE task SET status_id = ?, version = version + 1, updated_at = now() WHERE"
                + " workspace_id = ? AND list_id = ? AND status_id = ? RETURNING id, version",
            to,
            workspaceId,
            listId,
            from);
    for (Map<String, Object> row : changed) {
      events.record(
          workspaceId,
          "task",
          (UUID) row.get("id"),
          "task.status_changed",
          Map.of(
              "version",
              row.get("version"),
              "listId",
              listId.toString(),
              "cause",
              cause,
              "changes",
              Map.of("statusId", Map.of("from", from.toString(), "to", to.toString()))));
    }
  }
}
