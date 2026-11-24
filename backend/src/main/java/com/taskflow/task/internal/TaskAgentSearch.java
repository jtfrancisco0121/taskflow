package com.taskflow.task.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.field.CustomFieldSql;
import com.taskflow.field.FieldCatalog;
import com.taskflow.field.FieldInfo;
import com.taskflow.shared.AgentToolArgs;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.Page;
import com.taskflow.shared.PageCursor;
import com.taskflow.shared.TaskflowException;
import com.taskflow.task.BlockedSql;
import com.taskflow.workspace.LocationAccess;
import com.taskflow.workspace.LocationInfo;
import com.taskflow.workspace.LocationTree;
import com.taskflow.workspace.Role;
import com.taskflow.workspace.WorkspaceQuery;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The agent's search with a Location scope and custom field conditions (AD-10). One jOOQ query over
 * {@code task t JOIN location l} with bind values only; the conditions come from {@link
 * CustomFieldSql} (scope-guarded). It keeps the same base filters as {@link TaskSearchService} (the
 * Workspace, no trashed task, no archived List, the visibility rule), so a conditions search can
 * never return what the text search hides. With a text query it ranks and pages by {@code (ts_rank,
 * id)} like the text search; without one it orders by {@code updated_at DESC, id} with a cursor of
 * its own shape (tagged {@code u}), so a ranked cursor is refused rather than misread.
 */
@Service
class TaskAgentSearch {

  /** One custom field condition of a search call. */
  record Cond(UUID fieldId, String op, JsonNode value) {}

  private static final String FROM =
      "task t JOIN workspace w ON w.id = t.workspace_id JOIN location l ON l.workspace_id ="
          + " t.workspace_id AND l.id = t.list_id";
  private static final String TAG = "u";

  private final DSLContext dsl;
  private final FieldCatalog catalog;
  private final CustomFieldSql customSql;
  private final WorkspaceQuery workspaces;
  private final LocationTree tree;
  private final Clock clock = Clock.systemUTC();

  TaskAgentSearch(
      DSLContext dsl,
      FieldCatalog catalog,
      CustomFieldSql customSql,
      WorkspaceQuery workspaces,
      LocationTree tree) {
    this.dsl = dsl;
    this.catalog = catalog;
    this.customSql = customSql;
    this.workspaces = workspaces;
    this.tree = tree;
  }

  @Transactional(readOnly = true)
  Page<TaskSearchService.SearchHit> search(
      UUID workspaceId,
      UUID locationId,
      String query,
      List<Cond> conditions,
      Boolean blocked,
      String cursor,
      Integer requestedLimit) {
    String q = query == null || query.isBlank() ? null : query.trim();
    if (q == null && conditions.isEmpty() && blocked == null) {
      throw AgentToolArgs.invalid("Pass a query, blocked or at least one customFields condition");
    }
    if (q != null && q.length() > TaskSearchService.MAX_QUERY) {
      throw TaskflowException.badRequest(
          "search.invalid_query", "A search query has 1 to 200 characters");
    }
    int limit =
        requestedLimit == null
            ? TaskSearchService.DEFAULT_LIMIT
            : Math.min(requestedLimit, TaskSearchService.MAX_LIMIT);
    if (limit < 1) {
      throw TaskflowException.badRequest("page.invalid_limit", "limit must be at least 1");
    }
    UUID me = CurrentActor.userId();
    Role role =
        workspaces
            .roleOf(workspaceId, me)
            .orElseThrow(
                () -> TaskflowException.notFound("workspace.not_found", "Workspace not found"));
    LocalDate today = LocalDate.now(clock.withZone(ZoneOffset.UTC));

    Condition where =
        DSL.condition("t.workspace_id = {0}", DSL.val(workspaceId))
            .and("t.deleted_at IS NULL")
            .and("l.archived_at IS NULL")
            .and(DSL.condition(LocationAccess.condition("l"), DSL.val(me), DSL.val(role.name())));
    if (locationId != null) {
      LocationInfo scope =
          tree.find(locationId)
              .filter(l -> l.workspaceId().equals(workspaceId) && !l.deleted())
              .orElseThrow(
                  () -> TaskflowException.notFound("location.not_found", "Location not found"));
      where = where.and(DSL.condition("l.path <@ CAST({0} AS ltree)", DSL.val(scope.path())));
    }
    if (blocked != null) {
      // The one definition of blocked (AD-3), never a second predicate here.
      Condition isBlocked = DSL.condition(BlockedSql.blocked("t"));
      where = where.and(blocked ? isBlocked : isBlocked.not());
    }
    for (Cond c : conditions) {
      FieldInfo f =
          catalog
              .lookup(c.fieldId())
              .filter(x -> !x.retired() && x.workspaceId().equals(workspaceId))
              .orElseThrow(() ->
                  TaskflowException.notFound(
                      "field.not_found", "Custom field " + c.fieldId() + " not found"));
      CustomFieldSql.validateCondition(f, c.op(), c.value(), AgentToolArgs::invalid);
      CustomFieldSql.requireKnownOptions(f, c.value(), AgentToolArgs::invalid);
      where =
          where.and(
              customSql.filter(
                  customSql.bind(f),
                  c.op(),
                  c.value(),
                  me,
                  d -> CustomFieldSql.dayRange(d, today),
                  "t",
                  "l.path"));
    }

    List<Field<?>> select = new ArrayList<>();
    select.add(DSL.field("t.id", UUID.class).as("id"));
    select.add(DSL.field("t.title", String.class).as("title"));
    select.add(DSL.field("w.key || '-' || t.number", String.class).as("readable_id"));
    select.add(DSL.field("t.list_id", UUID.class).as("list_id"));
    select.add(DSL.field("l.name", String.class).as("list_name"));
    select.add(DSL.field(BlockedSql.blockerCount("t"), Integer.class).as("blocker_count"));
    List<org.jooq.SortField<?>> order = new ArrayList<>();
    Field<Double> rank = null;
    if (q != null) {
      rank =
          DSL.field(
              "CAST(ts_rank(t.search, websearch_to_tsquery('english', {0})) AS float8)",
              Double.class, DSL.val(q));
      where =
          where.and(DSL.condition("t.search @@ websearch_to_tsquery('english', {0})", DSL.val(q)));
      select.add(rank.as("rank"));
      select.add(
          DSL.field(
                  "ts_headline('english', t.title || ' ' || coalesce((SELECT string_agg(v #>> '{}',"
                      + " ' ') FROM jsonb_path_query(t.description, 'strict $.**.text') v), ''),"
                      + " websearch_to_tsquery('english', {0}), 'StartSel=<mark>, StopSel=</mark>,"
                      + " MaxWords=24, MinWords=8, MaxFragments=1')",
                  String.class, DSL.val(q))
              .as("snippet"));
      order.add(rank.desc());
      order.add(DSL.field("t.id", UUID.class).asc());
      List<String> after = PageCursor.decode(cursor, 2);
      if (after != null) {
        double ar;
        try {
          ar = Double.parseDouble(after.get(0));
        } catch (NumberFormatException e) {
          throw TaskflowException.badRequest("page.invalid_cursor", "Invalid cursor");
        }
        UUID aid = PageCursor.uuid(after.get(1));
        where =
            where.and(
                DSL.condition(
                    "({0} < {1} OR ({0} = {1} AND t.id > {2}))", rank, DSL.val(ar), DSL.val(aid)));
      }
    } else {
      select.add(DSL.field("t.updated_at", OffsetDateTime.class).as("updated_at"));
      order.add(DSL.field("t.updated_at", OffsetDateTime.class).desc());
      order.add(DSL.field("t.id", UUID.class).asc());
      List<String> after = PageCursor.decode(cursor, 3);
      if (after != null) {
        if (!TAG.equals(after.get(0))) {
          throw TaskflowException.badRequest("page.invalid_cursor", "Invalid cursor");
        }
        OffsetDateTime at;
        try {
          at = OffsetDateTime.ofInstant(Instant.parse(after.get(1)), ZoneOffset.UTC);
        } catch (java.time.format.DateTimeParseException e) {
          throw TaskflowException.badRequest("page.invalid_cursor", "Invalid cursor");
        }
        UUID aid = PageCursor.uuid(after.get(2));
        where =
            where.and(
                DSL.condition(
                    "(t.updated_at < {0} OR (t.updated_at = {0} AND t.id > {1}))",
                    DSL.val(at), DSL.val(aid)));
      }
    }

    List<Record> rows =
        dsl.select(select)
            .from(DSL.table(FROM))
            .where(where)
            .orderBy(order)
            .limit(limit + 1)
            .fetch();
    boolean more = rows.size() > limit;
    List<Record> page = more ? rows.subList(0, limit) : rows;
    List<TaskSearchService.SearchHit> hits = new ArrayList<>();
    for (Record r : page) {
      hits.add(
          new TaskSearchService.SearchHit(
              r.get("id", UUID.class),
              r.get("readable_id", String.class),
              r.get("title", String.class),
              r.get("list_id", UUID.class),
              r.get("list_name", String.class),
              q == null ? null : r.get("snippet", String.class),
              r.get("blocker_count", Integer.class) > 0,
              r.get("blocker_count", Integer.class)));
    }
    String next = null;
    if (more) {
      Record last = page.get(page.size() - 1);
      next =
          q != null
              ? PageCursor.encode(
                  Double.toString(last.get("rank", Double.class)),
                  last.get("id", UUID.class).toString())
              : PageCursor.encode(
                  TAG,
                  last.get("updated_at", OffsetDateTime.class).toInstant().toString(),
                  last.get("id", UUID.class).toString());
    }
    return new Page<>(hits, next);
  }
}
