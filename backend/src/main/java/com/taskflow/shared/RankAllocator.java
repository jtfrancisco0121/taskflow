package com.taskflow.shared;

import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Computes a rank for a row inside one rank scope from its neighbours (AD-10). Callers lock the
 * scope first with {@link RankScopeLock}. When a rank signals a rebalance the scope is re-ranked
 * with {@link RankService#spread(int)} in the same transaction.
 */
@Component
public class RankAllocator {

  /**
   * A rank scope: a table with {@code id} and {@code rank} columns, and a WHERE fragment that
   * selects the live rows of one scope.
   */
  public record Scope(String table, String where, Object... args) {}

  private record Row(UUID id, String rank) {}

  private final JdbcTemplate jdbc;

  RankAllocator(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public String append(Scope scope) {
    return place(scope, null, null, null);
  }

  /**
   * Rank for a row placed before {@code beforeId} or after {@code afterId} (before wins), or at the
   * end when both are null. {@code movingId} is excluded from the neighbours.
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public String place(Scope scope, UUID movingId, UUID beforeId, UUID afterId) {
    for (int attempt = 0; attempt < 2; attempt++) {
      List<Row> rows = rows(scope, movingId);
      RankService.Rank rank = compute(rows, beforeId, afterId);
      if (rank.value() != null && !rank.needsRebalance()) {
        return rank.value();
      }
      if (attempt == 0) {
        rebalance(scope, rows);
      } else if (rank.value() != null) {
        return rank.value();
      }
    }
    throw new IllegalStateException("rank could not be computed");
  }

  private RankService.Rank compute(List<Row> rows, UUID beforeId, UUID afterId) {
    if (beforeId == null && afterId == null) {
      return rows.isEmpty()
          ? RankService.first()
          : RankService.after(rows.get(rows.size() - 1).rank());
    }
    UUID anchor = beforeId != null ? beforeId : afterId;
    int index = -1;
    for (int i = 0; i < rows.size(); i++) {
      if (rows.get(i).id().equals(anchor)) {
        index = i;
      }
    }
    if (index < 0) {
      throw TaskflowException.badRequest(
          "rank.neighbour_out_of_scope", "beforeId/afterId must be a sibling in the same scope");
    }
    if (beforeId != null) {
      String hi = rows.get(index).rank();
      String lo = index > 0 ? rows.get(index - 1).rank() : null;
      return RankService.between(lo, hi);
    }
    String lo = rows.get(index).rank();
    String hi = index + 1 < rows.size() ? rows.get(index + 1).rank() : null;
    return RankService.between(lo, hi);
  }

  private List<Row> rows(Scope scope, UUID movingId) {
    String sql =
        "SELECT id, rank FROM "
            + scope.table()
            + " WHERE "
            + scope.where()
            + (movingId != null ? " AND id <> ?" : "")
            + " ORDER BY rank COLLATE \"C\", id";
    Object[] args =
        movingId == null
            ? scope.args()
            : java.util.stream.Stream.concat(
                    java.util.Arrays.stream(scope.args()), java.util.stream.Stream.of(movingId))
                .toArray();
    return jdbc.query(
        sql, (rs, i) -> new Row(rs.getObject("id", UUID.class), rs.getString("rank")), args);
  }

  private void rebalance(Scope scope, List<Row> rows) {
    List<String> ranks = RankService.spread(rows.size());
    for (int i = 0; i < rows.size(); i++) {
      jdbc.update(
          "UPDATE " + scope.table() + " SET rank = ? WHERE id = ?", ranks.get(i), rows.get(i).id());
    }
  }
}
