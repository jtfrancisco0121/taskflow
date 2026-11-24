package com.taskflow.field.internal;

import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.LocationInfo;
import com.taskflow.workspace.LocationMoved;
import com.taskflow.workspace.LocationTree;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Refuses a Location move that would put two live custom fields of one name on a branch (AD-5). A
 * plain synchronous listener, like the status remap: throwing rolls the move back. Values of fields
 * the moved Lists leave behind are not touched and come back if they return.
 */
@Component
class FieldMoveListener {

  private final JdbcTemplate jdbc;
  private final LocationTree tree;
  private final FieldLock lock;

  FieldMoveListener(JdbcTemplate jdbc, LocationTree tree, FieldLock lock) {
    this.jdbc = jdbc;
    this.tree = tree;
    this.lock = lock;
  }

  @EventListener
  void on(LocationMoved moved) {
    if (moved.newParentId() == null) {
      return;
    }
    LocationInfo parent = tree.find(moved.newParentId()).orElse(null);
    if (parent == null) {
      return;
    }
    lock.lock(moved.workspaceId());
    List<UUID> ancestors = parent.selfAndAncestorIds();
    List<UUID> subtree = tree.locationIdsAtOrUnder(moved.locationId());
    List<Map<String, Object>> clashes =
        jdbc.queryForList(
            "SELECT a.name AS ancestor_name, b.name AS moved_name, la.name AS ancestor_location,"
                + " lb.name AS moved_location FROM custom_field a JOIN custom_field b ON"
                + " lower(btrim(a.name)) = lower(btrim(b.name)) JOIN location la ON la.id ="
                + " a.location_id JOIN location lb ON lb.id = b.location_id WHERE a.workspace_id = ?"
                + " AND b.workspace_id = ? AND a.retired_at IS NULL AND b.retired_at IS NULL AND"
                + " a.location_id = ANY (CAST(? AS uuid[])) AND b.location_id = ANY (CAST(? AS"
                + " uuid[])) ORDER BY a.name LIMIT 1",
            moved.workspaceId(),
            moved.workspaceId(),
            FieldCatalogImpl.chain(ancestors),
            FieldCatalogImpl.chain(subtree));
    if (!clashes.isEmpty()) {
      Map<String, Object> c = clashes.get(0);
      throw TaskflowException.conflict(
              "field.name_taken",
              "Cannot move here: '"
                  + c.get("moved_name")
                  + "' (defined at "
                  + c.get("moved_location")
                  + ") is already used by '"
                  + c.get("ancestor_name")
                  + "' (defined at "
                  + c.get("ancestor_location")
                  + ") on the new branch")
          .with("name", String.valueOf(c.get("moved_name")));
    }
  }
}
