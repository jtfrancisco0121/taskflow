package com.taskflow.field.internal;

import com.taskflow.field.StatusCatalog;
import com.taskflow.field.StatusGroup;
import com.taskflow.field.StatusInfo;
import com.taskflow.workspace.LocationInfo;
import com.taskflow.workspace.LocationTree;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

@Component
class StatusCatalogImpl implements StatusCatalog {

  private static final RowMapper<StatusInfo> MAPPER =
      (rs, i) ->
          new StatusInfo(
              rs.getObject("id", UUID.class),
              rs.getString("name"),
              StatusGroup.valueOf(rs.getString("status_group")),
              rs.getString("color"),
              rs.getObject("location_id", UUID.class));

  private final JdbcTemplate jdbc;
  private final LocationTree tree;

  StatusCatalogImpl(JdbcTemplate jdbc, LocationTree tree) {
    this.jdbc = jdbc;
    this.tree = tree;
  }

  @Override
  public List<StatusInfo> effectiveSet(UUID locationId) {
    Optional<LocationInfo> location = tree.find(locationId);
    if (location.isEmpty()) {
      return List.of();
    }
    String chain =
        location.get().selfAndAncestorIds().stream()
            .map(UUID::toString)
            .collect(Collectors.joining(",", "{", "}"));
    // One query: the nearest ancestor-or-self with live rows, then its rows in rank order.
    return jdbc.query(
        "SELECT s.id, s.name, s.status_group, s.color, s.location_id FROM status s WHERE s.location_id"
            + " = (SELECT x.location_id FROM status x WHERE x.location_id = ANY (CAST(? AS uuid[]))"
            + " AND x.retired_at IS NULL ORDER BY array_position(CAST(? AS uuid[]), x.location_id)"
            + " LIMIT 1) AND s.retired_at IS NULL ORDER BY s.rank COLLATE \"C\", s.id",
        MAPPER,
        chain,
        chain);
  }

  @Override
  public boolean isValid(UUID listId, UUID statusId) {
    return effectiveSet(listId).stream().anyMatch(s -> s.id().equals(statusId));
  }

  @Override
  public Optional<UUID> firstNotStarted(UUID listId) {
    return sameGroupFirst(listId, StatusGroup.NOT_STARTED);
  }

  @Override
  public Optional<UUID> sameGroupFirst(UUID listId, StatusGroup group) {
    return effectiveSet(listId).stream()
        .filter(s -> s.group() == group)
        .map(StatusInfo::id)
        .findFirst();
  }

  @Override
  public Optional<StatusInfo> find(UUID statusId) {
    return jdbc
        .query(
            "SELECT id, name, status_group, color, location_id FROM status WHERE id = ?",
            MAPPER,
            statusId)
        .stream()
        .findFirst();
  }
}
