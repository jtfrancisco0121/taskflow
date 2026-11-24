package com.taskflow.task.internal;

import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.Page;
import com.taskflow.shared.PageCursor;
import com.taskflow.shared.TaskflowException;
import com.taskflow.task.BlockedSql;
import com.taskflow.workspace.LocationAccess;
import com.taskflow.workspace.Role;
import com.taskflow.workspace.WorkspaceQuery;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Full-text search of a Workspace under the same visibility rule as every task read (SEARCH-1). */
@Service
class TaskSearchService {

  static final int DEFAULT_LIMIT = 20;
  static final int MAX_LIMIT = 50;
  static final int MAX_QUERY = 200;

  /**
   * A hit; {@code snippet} wraps the matched words in {@code <mark>}. {@code blocked} and {@code
   * blockerCount} come from {@link BlockedSql}.
   */
  record SearchHit(
      UUID taskId,
      String readableId,
      String title,
      UUID listId,
      String listName,
      String snippet,
      boolean blocked,
      int blockerCount) {}

  private final NamedParameterJdbcTemplate named;
  private final WorkspaceQuery workspaces;

  TaskSearchService(NamedParameterJdbcTemplate named, WorkspaceQuery workspaces) {
    this.named = named;
    this.workspaces = workspaces;
  }

  @Transactional(readOnly = true)
  Page<SearchHit> search(UUID workspaceId, String q, String cursor, Integer requestedLimit) {
    if (q == null || q.isBlank() || q.length() > MAX_QUERY) {
      throw TaskflowException.badRequest(
          "search.invalid_query", "A search query has 1 to 200 characters");
    }
    int limit = requestedLimit == null ? DEFAULT_LIMIT : Math.min(requestedLimit, MAX_LIMIT);
    if (limit < 1) {
      throw TaskflowException.badRequest("page.invalid_limit", "limit must be at least 1");
    }
    List<String> after = PageCursor.decode(cursor, 2);
    Role role =
        workspaces
            .roleOf(workspaceId, CurrentActor.userId())
            .orElseThrow(
                () -> TaskflowException.notFound("workspace.not_found", "Workspace not found"));
    MapSqlParameterSource params =
        new MapSqlParameterSource(LocationAccess.params(CurrentActor.userId(), role));
    params.addValue("w", workspaceId);
    params.addValue("q", q.trim());
    params.addValue("n", limit + 1);
    String keyset = "";
    if (after != null) {
      double rank;
      try {
        rank = Double.parseDouble(after.get(0));
      } catch (NumberFormatException e) {
        throw TaskflowException.badRequest("page.invalid_cursor", "Invalid cursor");
      }
      params.addValue("ar", rank);
      params.addValue("aid", PageCursor.uuid(after.get(1)));
      keyset = " WHERE (r.rank < :ar OR (r.rank = :ar AND r.id > :aid))";
    }
    String sql =
        "SELECT p.id, p.readable_id, p.title, p.list_id, p.list_name, p.rank, p.blocker_count,"
            + " ts_headline('english',"
            + " p.title || ' ' || coalesce((SELECT string_agg(v #>> '{}', ' ') FROM"
            + " jsonb_path_query(p.description, 'strict $.**.text') v), ''),"
            + " websearch_to_tsquery('english', :q),"
            + " 'StartSel=<mark>, StopSel=</mark>, MaxWords=24, MinWords=8, MaxFragments=1') AS"
            + " snippet FROM (SELECT r.* FROM (SELECT t.id, t.title, t.description, t.list_id, l.name AS"
            + " list_name, w.key || '-' || t.number AS readable_id, CAST(ts_rank(t.search,"
            + " websearch_to_tsquery('english', :q)) AS float8) AS rank, "
            + BlockedSql.blockerCount("t")
            + " AS blocker_count FROM task t JOIN workspace w"
            + " ON w.id = t.workspace_id JOIN location l ON l.workspace_id = t.workspace_id AND l.id ="
            + " t.list_id WHERE t.workspace_id = :w AND t.deleted_at IS NULL AND l.archived_at IS NULL"
            + " AND "
            + LocationAccess.visible("l")
            + " AND t.search @@ websearch_to_tsquery('english', :q)) r"
            + keyset
            + " ORDER BY r.rank DESC, r.id LIMIT :n) p ORDER BY p.rank DESC, p.id";
    record Row(SearchHit hit, double rank) {}
    List<Row> rows =
        named.query(
            sql,
            params,
            (rs, i) ->
                new Row(
                    new SearchHit(
                        rs.getObject("id", UUID.class),
                        rs.getString("readable_id"),
                        rs.getString("title"),
                        rs.getObject("list_id", UUID.class),
                        rs.getString("list_name"),
                        rs.getString("snippet"),
                        rs.getInt("blocker_count") > 0,
                        rs.getInt("blocker_count")),
                    rs.getDouble("rank")));
    boolean more = rows.size() > limit;
    List<Row> pageRows = more ? rows.subList(0, limit) : rows;
    String next =
        more
            ? PageCursor.encode(
                Double.toString(pageRows.get(pageRows.size() - 1).rank()),
                pageRows.get(pageRows.size() - 1).hit().taskId().toString())
            : null;
    return new Page<>(pageRows.stream().map(Row::hit).toList(), next);
  }
}
