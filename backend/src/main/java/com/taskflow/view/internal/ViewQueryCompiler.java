package com.taskflow.view.internal;

import static com.taskflow.view.internal.Schema.*;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.field.CustomFieldSql;
import com.taskflow.shared.PageCursor;
import com.taskflow.shared.TaskflowException;
import com.taskflow.view.ViewConfig;
import com.taskflow.workspace.LocationAccess;
import com.taskflow.workspace.Role;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Select;
import org.jooq.SelectJoinStep;
import org.jooq.SortField;
import org.jooq.Table;
import org.jooq.impl.DSL;

/**
 * Turns a View config into a jOOQ query (VIEW-1, VIEW-4, AD-5 to AD-7). Every query is rooted at
 * {@code task t JOIN location l} with the workspace, trash, archive, scope and visibility
 * predicates; filters come from the catalog in view-config.md. Ordering is a list of columns (group
 * columns, sort keys, task id), all {@code NULLS LAST}, and the cursor holds the value of each, so
 * a page boundary is an exact keyset comparison.
 */
final class ViewQueryCompiler {

  /** Who asks and where: the Workspace, the Location path (null at Workspace scope), the caller. */
  record Scope(UUID workspaceId, String path, UUID userId, Role role) {}

  /**
   * One page request. {@code custom} holds the bound custom fields of the config, keyed by their
   * {@code cf:<id>} reference.
   */
  record Request(
      Scope scope,
      ViewConfig config,
      String groupValue,
      String cursor,
      int limit,
      Map<String, CustomFieldSql.Bound> custom) {
    Request(Scope scope, ViewConfig config, String groupValue, String cursor, int limit) {
      this(scope, config, groupValue, cursor, limit, Map.of());
    }
  }

  /** One ORDER BY column; {@code alias} names it in the select list. */
  record OrderCol(String alias, Field<?> expr, boolean asc) {}

  /** A query ready to run: {@code limit + 1} rows, then {@link #cursorFor}. */
  record Compiled(Select<Record> select, List<OrderCol> cols, Field<String> groupKey, int limit) {}

  /** A grouping: its key and label, and the columns that order its groups. */
  private record Grouping(
      Field<String> key,
      Field<String> label,
      List<Field<?>> order,
      boolean needsStatus,
      boolean needsAssignee) {}

  private final Clock clock;
  private final ObjectMapper mapper;
  private final CustomFieldSql customSql;

  ViewQueryCompiler(Clock clock, ObjectMapper mapper) {
    this(clock, mapper, null);
  }

  ViewQueryCompiler(Clock clock, ObjectMapper mapper, CustomFieldSql customSql) {
    this.clock = clock;
    this.mapper = mapper;
    this.customSql = customSql;
  }

  // ---- public entry points ----

  Compiled compile(DSLContext dsl, Request r) {
    ViewConfig config = r.config();
    LocalDate today = today();
    Grouping grouping = grouping(config.group(), today, r);
    if (r.groupValue() != null && grouping == null) {
      throw TaskflowException.badRequest(
          "view.invalid_group_value", "groupValue needs a grouping in the config");
    }
    List<ViewConfig.Sort> sorts = sorts(config);
    List<OrderCol> cols = new ArrayList<>();
    int n = 0;
    if (grouping != null && r.groupValue() == null) {
      for (Field<?> f : grouping.order()) {
        cols.add(new OrderCol("k" + n++, f, true));
      }
      cols.add(new OrderCol("k" + n++, grouping.key(), true));
    }
    boolean needsStatus = grouping != null && grouping.needsStatus();
    for (ViewConfig.Sort s : sorts) {
      boolean asc = !"desc".equals(s.dir());
      switch (s.key()) {
        case "manual" -> {
          cols.add(new OrderCol("k" + n++, T_LIST, asc));
          cols.add(new OrderCol("k" + n++, T_RANK, asc));
        }
        case "title" -> cols.add(new OrderCol("k" + n++, DSL.lower(T_TITLE), asc));
        case "status" -> {
          needsStatus = true;
          cols.add(new OrderCol("k" + n++, statusOrder(), asc));
        }
        case "priority" -> cols.add(new OrderCol("k" + n++, priorityOrder(true), asc));
        case "dueDate" -> cols.add(new OrderCol("k" + n++, T_DUE, asc));
        case "startDate" -> cols.add(new OrderCol("k" + n++, T_START, asc));
        case "createdAt" -> cols.add(new OrderCol("k" + n++, T_CREATED, asc));
        case "updatedAt" -> cols.add(new OrderCol("k" + n++, T_UPDATED, asc));
        default -> {
          CustomFieldSql.Bound b = r.custom().get(s.key());
          if (b == null || customSql == null) {
            throw ViewConfigValidator.invalid("Unknown sort " + s.key());
          }
          cols.add(new OrderCol("k" + n++, customSql.sortKey(b, "t", "l.path"), asc));
        }
      }
    }
    cols.add(new OrderCol("k" + n, T_ID, true));

    Condition where = base(r.scope()).and(filter(config.filter(), r, today));
    if (r.groupValue() != null) {
      where = where.and(groupValue(grouping, config.group(), r.groupValue()));
    }
    String hash = hash(r, today);
    List<String> after = PageCursor.decode(r.cursor(), cols.size() + 1);
    if (after != null) {
      if (!after.get(0).equals(hash)) {
        throw invalidCursor();
      }
      where = where.and(keyset(cols, after));
    }
    List<Field<?>> select = new ArrayList<>();
    select.add(T_ID);
    Field<String> groupKey = null;
    if (grouping != null) {
      groupKey = grouping.key();
      select.add(groupKey.as("gk"));
    }
    for (OrderCol c : cols) {
      select.add(c.expr().as(c.alias()));
    }
    SelectJoinStep<Record> from = dsl.select(select).from(roots(needsStatus, grouping));
    List<SortField<?>> order = new ArrayList<>();
    for (OrderCol c : cols) {
      order.add(c.asc() ? c.expr().asc().nullsLast() : c.expr().desc().nullsLast());
    }
    Select<Record> query = from.where(where).orderBy(order).limit(r.limit() + 1);
    return new Compiled(query, cols, groupKey, r.limit());
  }

  /** The cursor that resumes after {@code row}, a row of {@link Compiled#select()}. */
  String cursorFor(Request r, Compiled c, Record row) {
    String[] parts = new String[c.cols().size() + 1];
    parts[0] = hash(r, today());
    for (int i = 0; i < c.cols().size(); i++) {
      Object v = row.get(c.cols().get(i).alias());
      parts[i + 1] = v == null ? "n" : "v" + text(v);
    }
    return PageCursor.encode(parts);
  }

  /** Group keys, labels and counts of the whole scope (first page only). */
  Select<Record> groups(DSLContext dsl, Request r) {
    ViewConfig config = r.config();
    LocalDate today = today();
    Grouping grouping = grouping(config.group(), today, r);
    if (grouping == null) {
      throw TaskflowException.badRequest("view.invalid_group_value", "The config has no grouping");
    }
    Condition where = base(r.scope()).and(filter(config.filter(), r, today));
    List<Field<?>> inner = new ArrayList<>();
    inner.add(grouping.key().as("gk"));
    inner.add(grouping.label().as("gl"));
    for (int i = 0; i < grouping.order().size(); i++) {
      inner.add(grouping.order().get(i).as("go" + i));
    }
    Table<?> derived =
        dsl.select(inner).from(roots(grouping.needsStatus(), grouping)).where(where).asTable("g");
    Field<String> gk = DSL.field(DSL.name("g", "gk"), TEXT);
    List<Field<?>> outer = new ArrayList<>();
    outer.add(gk);
    outer.add(DSL.min(DSL.field(DSL.name("g", "gl"), TEXT)).as("label"));
    List<SortField<?>> order = new ArrayList<>();
    for (int i = 0; i < grouping.order().size(); i++) {
      Field<?> o = DSL.field(DSL.name("g", "go" + i));
      order.add(DSL.min((Field<Comparable>) o).asc().nullsLast());
    }
    order.add(gk.asc());
    outer.add(DSL.count().as("n"));
    return dsl.select(outer).from(derived).groupBy(gk).orderBy(order);
  }

  // ---- scope ----

  private static Condition base(Scope s) {
    Condition c =
        T_WORKSPACE
            .eq(s.workspaceId())
            .and(T_DELETED.isNull())
            .and(L_ARCHIVED.isNull())
            .and(
                DSL.condition(
                    LocationAccess.condition("l"), DSL.val(s.userId()), DSL.val(s.role().name())));
    if (s.path() != null) {
      c = c.and(DSL.condition("l.path <@ CAST({0} AS ltree)", DSL.val(s.path())));
    }
    return c;
  }

  private Table<?> roots(boolean status, Grouping grouping) {
    return joins(status, grouping);
  }

  private Table<?> joins(boolean status, Grouping grouping) {
    Table<?> out = TASK.join(LOCATION).on(L_WORKSPACE.eq(T_WORKSPACE).and(L_ID.eq(T_LIST)));
    if (status) {
      out = out.join(STATUS).on(S_WORKSPACE.eq(T_WORKSPACE).and(S_ID.eq(T_STATUS)));
    }
    if (grouping != null && grouping.needsAssignee()) {
      out = out.leftJoin(GROUP_ASSIGNEE).on(GA_TASK.eq(T_ID));
    }
    return out;
  }

  // ---- grouping ----

  private Grouping grouping(String group, LocalDate today, Request r) {
    if (group == null || group.equals("none")) {
      return null;
    }
    if (group.startsWith("cf:")) {
      CustomFieldSql.Bound b = r.custom().get(group);
      if (b == null || customSql == null) {
        throw ViewConfigValidator.invalid("Unknown grouping " + group);
      }
      CustomFieldSql.Group g = customSql.group(b, "t", "l.path", today);
      return new Grouping(g.key(), g.label(), g.order(), false, false);
    }
    switch (group) {
      case "status" -> {
        Field<String> key = DSL.field("lower(btrim(s.name))", TEXT);
        return new Grouping(key, S_NAME, List.of(statusOrder()), true, false);
      }
      case "statusGroup" -> {
        Field<Integer> ord =
            DSL.field(
                "CASE s.status_group WHEN 'NOT_STARTED' THEN 0 WHEN 'ACTIVE' THEN 1 WHEN 'DONE' THEN 2"
                    + " ELSE 3 END",
                Integer.class);
        return new Grouping(S_GROUP, S_GROUP, List.of(ord), true, false);
      }
      case "priority" -> {
        return new Grouping(T_PRIORITY, T_PRIORITY, List.of(priorityOrder(false)), false, false);
      }
      case "assignee" -> {
        Field<String> key = DSL.field("coalesce(CAST(ga.user_id AS text), 'none')", TEXT);
        Field<Integer> ord =
            DSL.field("CASE WHEN ga.user_id IS NULL THEN 1 ELSE 0 END", Integer.class);
        return new Grouping(key, key, List.of(ord), false, true);
      }
      case "dueDate" -> {
        Instant start = today.atStartOfDay().toInstant(ZoneOffset.UTC);
        Instant tomorrow = start.plusSeconds(86400);
        Instant weekEnd =
            today
                .with(TemporalAdjusters.next(DayOfWeek.MONDAY))
                .atStartOfDay()
                .toInstant(ZoneOffset.UTC);
        String ts = "CAST('%s' AS timestamptz)";
        String s0 = ts.formatted(start), s1 = ts.formatted(tomorrow), s2 = ts.formatted(weekEnd);
        Field<String> key =
            DSL.field(
                "CASE WHEN t.due_date IS NULL THEN 'none' WHEN t.due_date < %s THEN 'overdue' WHEN t.due_date < %s THEN 'today' WHEN t.due_date < %s THEN 'this_week' ELSE 'later' END"
                    .formatted(s0, s1, s2),
                TEXT);
        Field<Integer> ord =
            DSL.field(
                "CASE WHEN t.due_date IS NULL THEN 4 WHEN t.due_date < %s THEN 0 WHEN t.due_date < %s THEN 1 WHEN t.due_date < %s THEN 2 ELSE 3 END"
                    .formatted(s0, s1, s2),
                Integer.class);
        return new Grouping(key, key, List.of(ord), false, false);
      }
      case "list" -> {
        Field<String> key = DSL.field("CAST(t.list_id AS text)", TEXT);
        return new Grouping(key, L_NAME, List.of(DSL.lower(L_NAME)), false, false);
      }
      default -> throw ViewConfigValidator.invalid("Unknown grouping " + group);
    }
  }

  private static Condition groupValue(Grouping g, String group, String value) {
    switch (group) {
      case "assignee", "list" -> {
        if (!value.equals("none")) {
          try {
            UUID.fromString(value);
          } catch (IllegalArgumentException e) {
            throw TaskflowException.badRequest(
                "view.invalid_group_value", "groupValue is not an id");
          }
        }
      }
      default -> {}
    }
    return g.key().eq(value);
  }

  /** Groups statuses of the same name together: status group first, then lowest position. */
  private static Field<String> statusOrder() {
    return DSL.field(
        "(SELECT min(CASE s2.status_group WHEN 'NOT_STARTED' THEN '0' WHEN 'ACTIVE' THEN '1' WHEN"
            + " 'DONE' THEN '2' ELSE '3' END || s2.rank) FROM status s2 WHERE s2.workspace_id ="
            + " t.workspace_id AND lower(btrim(s2.name)) = lower(btrim(s.name)))",
        TEXT);
  }

  /** URGENT first; NONE is empty (last when sorting) or 4 (a group of its own). */
  private static Field<Integer> priorityOrder(boolean noneIsNull) {
    return DSL.field(
        "CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 WHEN 'LOW'"
            + " THEN 3 ELSE "
            + (noneIsNull ? "NULL" : "4")
            + " END",
        Integer.class);
  }

  private static List<ViewConfig.Sort> sorts(ViewConfig config) {
    if (config.sort() == null || config.sort().isEmpty()) {
      return List.of(new ViewConfig.Sort("manual", "asc"));
    }
    return config.sort();
  }

  // ---- filters ----

  private Condition filter(ViewConfig.Filter f, Request r, LocalDate today) {
    Scope scope = r.scope();
    if (f == null) {
      return DSL.noCondition();
    }
    if (f.items() != null) {
      List<Condition> parts = new ArrayList<>();
      for (ViewConfig.Filter child : f.items()) {
        parts.add(filter(child, r, today));
      }
      return "OR".equals(f.op()) ? DSL.or(parts) : DSL.and(parts);
    }
    JsonNode v = f.value();
    if (f.field() != null && f.field().startsWith("cf:")) {
      CustomFieldSql.Bound b = r.custom().get(f.field());
      if (b == null || customSql == null) {
        throw ViewConfigValidator.invalid("Unknown filter field " + f.field());
      }
      return customSql.filter(b, f.op(), v, scope.userId(), d -> range(d, today), "t", "l.path");
    }
    switch (f.field()) {
      case "title" -> {
        Condition c = T_TITLE.containsIgnoreCase(v.asText());
        return f.op().equals("contains") ? c : c.not();
      }
      case "status" -> {
        return in(T_STATUS, uuids(v), f.op().equals("none_of"));
      }
      case "statusGroup" -> {
        Condition c =
            T_STATUS.in(
                DSL.select(FS_ID)
                    .from(FILTER_STATUS)
                    .where(FS_WORKSPACE.eq(T_WORKSPACE))
                    .and(FS_GROUP.in(strings(v))));
        return f.op().equals("none_of") ? c.not() : c;
      }
      case "priority" -> {
        return switch (f.op()) {
          case "is_set" -> T_PRIORITY.ne("NONE");
          case "is_empty" -> T_PRIORITY.eq("NONE");
          default -> in(T_PRIORITY, strings(v), f.op().equals("none_of"));
        };
      }
      case "assignee" -> {
        return assignee(f.op(), strings(v), scope);
      }
      case "tag" -> {
        return tag(f.op(), strings(v));
      }
      case "dueDate" -> {
        return date(T_DUE, f, today);
      }
      case "startDate" -> {
        return date(T_START, f, today);
      }
      case "createdAt" -> {
        return date(T_CREATED, f, today);
      }
      case "updatedAt" -> {
        return date(T_UPDATED, f, today);
      }
      case "list" -> {
        return in(T_LIST, uuids(v), f.op().equals("none_of"));
      }
      case "subtasks" -> {
        return f.op().equals("exclude") ? T_PARENT.isNull() : DSL.noCondition();
      }
      default -> throw ViewConfigValidator.invalid("Unknown filter field " + f.field());
    }
  }

  private static <T> Condition in(Field<T> field, List<T> values, boolean negate) {
    Condition c = field.in(values);
    return negate ? c.not() : c;
  }

  private Condition assignee(String op, List<String> raw, Scope scope) {
    Condition any = DSL.exists(DSL.selectOne().from(FILTER_ASSIGNEE).where(FA_TASK.eq(T_ID)));
    switch (op) {
      case "is_set" -> {
        return any;
      }
      case "is_empty" -> {
        return any.not();
      }
      default -> {}
    }
    List<UUID> ids = new ArrayList<>();
    for (String s : raw) {
      ids.add(s.equals("me") ? scope.userId() : UUID.fromString(s));
    }
    if (op.equals("all_of")) {
      List<Condition> each = new ArrayList<>();
      for (UUID id : ids) {
        each.add(
            DSL.exists(
                DSL.selectOne().from(FILTER_ASSIGNEE).where(FA_TASK.eq(T_ID)).and(FA_USER.eq(id))));
      }
      return DSL.and(each);
    }
    Condition has =
        DSL.exists(
            DSL.selectOne().from(FILTER_ASSIGNEE).where(FA_TASK.eq(T_ID)).and(FA_USER.in(ids)));
    return op.equals("none_of") ? has.not() : has;
  }

  private Condition tag(String op, List<String> tags) {
    Condition any = DSL.exists(DSL.selectOne().from(FILTER_TAG).where(FT_TASK.eq(T_ID)));
    if (op.equals("is_empty")) {
      return any.not();
    }
    List<String> clean =
        tags.stream().map(t -> t.trim().toLowerCase(java.util.Locale.ROOT)).toList();
    if (op.equals("all_of")) {
      List<Condition> each = new ArrayList<>();
      for (String t : clean) {
        each.add(
            DSL.exists(DSL.selectOne().from(FILTER_TAG).where(FT_TASK.eq(T_ID)).and(FT_TAG.eq(t))));
      }
      return DSL.and(each);
    }
    Condition has =
        DSL.exists(DSL.selectOne().from(FILTER_TAG).where(FT_TASK.eq(T_ID)).and(FT_TAG.in(clean)));
    return op.equals("none_of") ? has.not() : has;
  }

  private Condition date(Field<OffsetDateTime> col, ViewConfig.Filter f, LocalDate today) {
    JsonNode v = f.value();
    switch (f.op()) {
      case "is_empty" -> {
        return col.isNull();
      }
      case "is_set" -> {
        return col.isNotNull();
      }
      case "overdue" -> {
        OffsetDateTime start = utc(today.atStartOfDay().toInstant(ZoneOffset.UTC));
        return col.lt(start)
            .and(
                T_STATUS.notIn(
                    DSL.select(FS_ID)
                        .from(FILTER_STATUS)
                        .where(FS_WORKSPACE.eq(T_WORKSPACE))
                        .and(FS_GROUP.in("DONE", "CLOSED"))));
      }
      case "before" -> {
        return col.lt(utc(range(v.asText(), today)[0]));
      }
      case "after" -> {
        return col.ge(utc(range(v.asText(), today)[1]));
      }
      case "on" -> {
        Instant[] r = range(v.asText(), today);
        return col.ge(utc(r[0])).and(col.lt(utc(r[1])));
      }
      case "between" -> {
        Instant from = range(v.get(0).asText(), today)[0];
        Instant to = range(v.get(1).asText(), today)[1];
        return col.ge(utc(from)).and(col.lt(utc(to)));
      }
      default -> throw ViewConfigValidator.invalid("Unknown date operator " + f.op());
    }
  }

  /**
   * A day value as the UTC range [start, end): a day, or the week or 7 days a relative value names.
   */
  static Instant[] range(String value, LocalDate today) {
    LocalDate from;
    LocalDate to;
    switch (value) {
      case "today" -> {
        from = today;
        to = today.plusDays(1);
      }
      case "this_week" -> {
        from = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        to = from.plusDays(7);
      }
      case "next_7_days" -> {
        from = today;
        to = today.plusDays(7);
      }
      default -> {
        from = LocalDate.parse(value);
        to = from.plusDays(1);
      }
    }
    return new Instant[] {
      from.atStartOfDay().toInstant(ZoneOffset.UTC), to.atStartOfDay().toInstant(ZoneOffset.UTC)
    };
  }

  private static OffsetDateTime utc(Instant i) {
    return OffsetDateTime.ofInstant(i, ZoneOffset.UTC);
  }

  private static List<UUID> uuids(JsonNode v) {
    List<UUID> out = new ArrayList<>();
    v.forEach(n -> out.add(UUID.fromString(n.asText())));
    return out;
  }

  private static List<String> strings(JsonNode v) {
    List<String> out = new ArrayList<>();
    if (v != null) {
      v.forEach(n -> out.add(n.asText()));
    }
    return out;
  }

  // ---- keyset ----

  /**
   * Rows after the cursor under {@code ORDER BY ... NULLS LAST}: for each column, all earlier
   * columns equal and this one strictly later, where "later" than a value is a greater value or
   * NULL, and nothing is later than NULL.
   */
  private static Condition keyset(List<OrderCol> cols, List<String> after) {
    List<Condition> branches = new ArrayList<>();
    for (int i = 0; i < cols.size(); i++) {
      List<Condition> parts = new ArrayList<>();
      for (int j = 0; j < i; j++) {
        parts.add(equal(cols.get(j), after.get(j + 1)));
      }
      Condition later = later(cols.get(i), after.get(i + 1));
      if (later == null) {
        continue;
      }
      parts.add(later);
      branches.add(DSL.and(parts));
    }
    return branches.isEmpty() ? DSL.falseCondition() : DSL.or(branches);
  }

  private static Condition equal(OrderCol c, String raw) {
    if (raw.equals("n")) {
      return c.expr().isNull();
    }
    return DSL.condition("{0} = {1}", c.expr(), value(c, raw));
  }

  private static Condition later(OrderCol c, String raw) {
    if (raw.equals("n")) {
      return null;
    }
    Condition greater = DSL.condition(c.asc() ? "{0} > {1}" : "{0} < {1}", c.expr(), value(c, raw));
    return greater.or(c.expr().isNull());
  }

  private static Field<?> value(OrderCol c, String raw) {
    if (!raw.startsWith("v")) {
      throw invalidCursor();
    }
    String text = raw.substring(1);
    Class<?> type = c.expr().getType();
    try {
      if (type == UUID.class) {
        return DSL.val(UUID.fromString(text));
      } else if (type == Integer.class) {
        return DSL.val(Integer.valueOf(text));
      } else if (type == BigDecimal.class) {
        return DSL.val(new BigDecimal(text));
      } else if (type == OffsetDateTime.class) {
        return DSL.val(utc(Instant.parse(text)));
      }
      return DSL.val(text);
    } catch (IllegalArgumentException | java.time.format.DateTimeParseException e) {
      throw invalidCursor();
    }
  }

  private static String text(Object v) {
    if (v instanceof OffsetDateTime o) {
      return o.toInstant().toString();
    }
    if (v instanceof java.sql.Timestamp t) {
      return t.toInstant().toString();
    }
    if (v instanceof BigDecimal d) {
      return d.toPlainString();
    }
    return v.toString();
  }

  private static TaskflowException invalidCursor() {
    return TaskflowException.badRequest("page.invalid_cursor", "Invalid cursor");
  }

  // ---- misc ----

  LocalDate today() {
    return LocalDate.now(clock.withZone(ZoneOffset.UTC));
  }

  /** The scope, the filter, grouping and sort, the group value and the resolution day. */
  private String hash(Request r, LocalDate today) {
    ViewConfig c = r.config();
    try {
      String canonical =
          r.scope().workspaceId()
              + "|"
              + r.scope().path()
              + "|"
              + mapper.writeValueAsString(c.filter())
              + "|"
              + c.group()
              + "|"
              + mapper.writeValueAsString(sorts(c))
              + "|"
              + r.groupValue()
              + "|"
              + today;
      byte[] digest =
          MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(digest, 0, 8);
    } catch (JsonProcessingException | NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  private static final org.jooq.DataType<String> TEXT = Schema.TEXT;
}
