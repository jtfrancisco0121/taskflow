package com.taskflow.workspace.internal;

import com.taskflow.workspace.LocationInfo;
import com.taskflow.workspace.LocationTree;
import com.taskflow.workspace.LocationType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
class LocationTreeImpl implements LocationTree {

  private final JdbcTemplate jdbc;

  LocationTreeImpl(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public Optional<LocationInfo> find(UUID locationId) {
    return jdbc
        .query(
            "SELECT id, workspace_id, parent_id, type, name, path::text AS path, is_private,"
                + " archived_at IS NOT NULL AS archived, deleted_at IS NOT NULL AS deleted"
                + " FROM location WHERE id = ?",
            (rs, i) ->
                new LocationInfo(
                    rs.getObject("id", UUID.class),
                    rs.getObject("workspace_id", UUID.class),
                    rs.getObject("parent_id", UUID.class),
                    LocationType.valueOf(rs.getString("type")),
                    rs.getString("name"),
                    rs.getString("path"),
                    rs.getBoolean("is_private"),
                    rs.getBoolean("archived"),
                    rs.getBoolean("deleted")),
            locationId)
        .stream()
        .findFirst();
  }

  @Override
  public List<UUID> listIdsAtOrUnder(UUID locationId) {
    return jdbc.queryForList(
        "SELECT id FROM location WHERE type = 'LIST'"
            + " AND workspace_id = (SELECT workspace_id FROM location WHERE id = ?)"
            + " AND path <@ (SELECT path FROM location WHERE id = ?)",
        UUID.class,
        locationId,
        locationId);
  }

  @Override
  public List<UUID> locationIdsAtOrUnder(UUID locationId) {
    return jdbc.queryForList(
        "SELECT id FROM location"
            + " WHERE workspace_id = (SELECT workspace_id FROM location WHERE id = ?)"
            + " AND path <@ (SELECT path FROM location WHERE id = ?)",
        UUID.class,
        locationId,
        locationId);
  }
}
