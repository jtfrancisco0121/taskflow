package com.taskflow.shared;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Keyset read of the activity log of one entity, newest first (CMT-2). */
@Component
public class ActivityQuery {

  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;

  ActivityQuery(JdbcTemplate jdbc, ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.mapper = mapper;
  }

  public Page<ActivityItem> forEntity(
      UUID workspaceId, String entity, UUID entityId, String cursor, Integer requestedLimit) {
    int limit = PageCursor.limit(requestedLimit);
    List<String> after = PageCursor.decode(cursor, 2);
    StringBuilder sql =
        new StringBuilder(
            "SELECT id, type, actor_type, actor_id, actor_key_id, payload::text AS payload,"
                + " created_at,"
                + " (EXTRACT(EPOCH FROM created_at) * 1000000)::bigint AS micros"
                + " FROM activity_event WHERE workspace_id = ? AND entity = ? AND entity_id = ?");
    java.util.ArrayList<Object> args =
        new java.util.ArrayList<>(List.of(workspaceId, entity, entityId));
    if (after != null) {
      sql.append(
          " AND (created_at, id) < (timestamptz 'epoch' + CAST(? AS bigint) * interval '1 microsecond', ?)");
      args.add(com.taskflow.shared.PageCursor.number(after.get(0)));
      args.add(com.taskflow.shared.PageCursor.uuid(after.get(1)));
    }
    sql.append(" ORDER BY created_at DESC, id DESC LIMIT ?");
    args.add(limit + 1);
    record Row(ActivityItem item, long micros) {}
    List<Row> rows =
        jdbc.query(
            sql.toString(),
            (rs, i) -> {
              Timestamp ts = rs.getTimestamp("created_at");
              try {
                return new Row(
                    new ActivityItem(
                        rs.getObject("id", UUID.class),
                        rs.getString("type"),
                        ActorType.valueOf(rs.getString("actor_type")),
                        rs.getObject("actor_id", UUID.class),
                        rs.getObject("actor_key_id", UUID.class),
                        mapper.readTree(rs.getString("payload")),
                        ts.toInstant()),
                    rs.getLong("micros"));
              } catch (JsonProcessingException e) {
                throw new IllegalStateException(e);
              }
            },
            args.toArray());
    boolean more = rows.size() > limit;
    List<Row> page = more ? rows.subList(0, limit) : rows;
    List<ActivityItem> items = page.stream().map(Row::item).toList();
    String next =
        more
            ? PageCursor.encode(
                String.valueOf(page.get(page.size() - 1).micros()),
                page.get(page.size() - 1).item().id().toString())
            : null;
    return new Page<>(items, next);
  }
}
