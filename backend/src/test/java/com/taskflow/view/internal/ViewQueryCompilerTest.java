package com.taskflow.view.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.shared.TaskflowException;
import com.taskflow.view.ViewConfig;
import com.taskflow.workspace.Role;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.SQLDialect;
import org.jooq.conf.ParamType;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("VIEW-1 query compiler SQL")
class ViewQueryCompilerTest {

  private static final ObjectMapper M = new ObjectMapper();
  // Wednesday 2026-11-25 (UTC)
  private static final Clock CLOCK =
      Clock.fixed(Instant.parse("2026-11-25T10:15:00Z"), ZoneOffset.UTC);
  private final DSLContext dsl = DSL.using(SQLDialect.POSTGRES);
  private final ViewQueryCompiler compiler = new ViewQueryCompiler(CLOCK, M);
  private final UUID user = UUID.fromString("018f1e2a-0000-7000-8000-0000000000aa");
  private final ViewQueryCompiler.Scope scope =
      new ViewQueryCompiler.Scope(UUID.randomUUID(), "a.b", user, Role.MEMBER);

  private String sql(ViewConfig config) {
    return sql(config, null, null);
  }

  private String sql(ViewConfig config, String groupValue, String cursor) {
    ViewQueryCompiler.Compiled c =
        compiler.compile(dsl, new ViewQueryCompiler.Request(scope, config, groupValue, cursor, 50));
    return c.select().getSQL(ParamType.INLINED);
  }

  private static ViewConfig.Filter cond(String field, String op, String json) {
    try {
      return new ViewConfig.Filter(op, field, json == null ? null : M.readTree(json), null);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private static ViewConfig filtered(ViewConfig.Filter f) {
    return new ViewConfig(1, f, null, null, null, null);
  }

  @Test
  void everyQueryIsRootedAtTheScopeAndVisibilityPredicates() {
    String sql = sql(ViewConfig.empty());
    assertThat(sql)
        .contains("\"t\".\"workspace_id\" =")
        .contains("\"t\".\"deleted_at\" is null")
        .contains("\"l\".\"archived_at\" is null")
        .contains("l.path <@ CAST('a.b' AS ltree)")
        .contains("location_grant")
        .contains("order by")
        .contains("nulls last")
        .contains("fetch next 51 rows only");
    assertThat(sql).contains("'" + user + "'");
  }

  @Test
  void workspaceScopeDropsThePathPredicate() {
    ViewQueryCompiler.Scope ws =
        new ViewQueryCompiler.Scope(UUID.randomUUID(), null, user, Role.OWNER);
    String sql =
        compiler
            .compile(dsl, new ViewQueryCompiler.Request(ws, ViewConfig.empty(), null, null, 10))
            .select()
            .getSQL(ParamType.INLINED);
    assertThat(sql).doesNotContain("ltree");
  }

  @Test
  void filtersCompileForEveryField() {
    assertThat(sql(filtered(cond("title", "contains", "\"50%_off\""))))
        .contains("ilike")
        .contains("escape");
    assertThat(
            sql(filtered(cond("status", "none_of", "[\"018f1e2a-0000-7000-8000-000000000001\"]"))))
        .contains("not")
        .contains("018f1e2a-0000-7000-8000-000000000001");
    assertThat(sql(filtered(cond("statusGroup", "any_of", "[\"DONE\"]")))).contains("status_group");
    assertThat(sql(filtered(cond("priority", "is_set", null)))).contains("<> 'NONE'");
    assertThat(sql(filtered(cond("assignee", "any_of", "[\"me\"]"))))
        .contains("task_assignee")
        .contains(user.toString());
    assertThat(sql(filtered(cond("assignee", "is_empty", null)))).contains("not exists");
    assertThat(sql(filtered(cond("tag", "all_of", "[\"a\",\"b\"]")))).contains("task_tag");
    assertThat(sql(filtered(cond("list", "any_of", "[\"018f1e2a-0000-7000-8000-000000000001\"]"))))
        .contains("\"t\".\"list_id\" in");
    assertThat(sql(filtered(cond("subtasks", "exclude", null))))
        .contains("parent_task_id\" is null");
    assertThat(sql(filtered(cond("dueDate", "overdue", null)))).contains("DONE");
  }

  @Test
  void relativeDatesResolveToUtcDaysWithTheFixedClock() {
    LocalDate today = LocalDate.parse("2026-11-25");
    assertThat(ViewQueryCompiler.range("today", today))
        .containsExactly(
            Instant.parse("2026-11-25T00:00:00Z"), Instant.parse("2026-11-26T00:00:00Z"));
    assertThat(ViewQueryCompiler.range("this_week", today))
        .containsExactly(
            Instant.parse("2026-11-23T00:00:00Z"), Instant.parse("2026-11-30T00:00:00Z"));
    assertThat(ViewQueryCompiler.range("next_7_days", today))
        .containsExactly(
            Instant.parse("2026-11-25T00:00:00Z"), Instant.parse("2026-12-02T00:00:00Z"));
    assertThat(sql(filtered(cond("dueDate", "before", "\"today\""))))
        .contains("2026-11-25 00:00:00+00:00");
    assertThat(sql(filtered(cond("dueDate", "between", "[\"2026-01-01\",\"2026-01-31\"]"))))
        .contains("2026-01-01 00:00:00+00:00")
        .contains("2026-02-01 00:00:00+00:00");
  }

  @Test
  void groupingAndSortBuildTheirColumns() {
    for (String group :
        List.of("status", "statusGroup", "priority", "assignee", "dueDate", "list")) {
      assertThat(sql(new ViewConfig(1, null, group, null, null, null))).contains("order by");
    }
    assertThat(sql(new ViewConfig(1, null, "assignee", null, null, null)))
        .contains("task_assignee");
    assertThat(sql(new ViewConfig(1, null, "status", null, null, null)))
        .contains("lower(btrim(s.name))");
    String sorted =
        sql(
            new ViewConfig(
                1,
                null,
                null,
                List.of(
                    new ViewConfig.Sort("dueDate", "desc"), new ViewConfig.Sort("title", "asc")),
                null,
                null));
    assertThat(sorted).contains("\"t\".\"due_date\" desc nulls last").contains("lower(");
    assertThat(sorted).endsWith("fetch next 51 rows only");
  }

  @Test
  void aCursorFromAnotherConfigIsRefused() {
    ViewQueryCompiler.Request r =
        new ViewQueryCompiler.Request(scope, ViewConfig.empty(), null, null, 50);
    ViewQueryCompiler.Compiled c = compiler.compile(dsl, r);
    String bogus = com.taskflow.shared.PageCursor.encode("0000000000000000", "n", "n", "n");
    assertThatThrownBy(() -> sql(ViewConfig.empty(), null, bogus))
        .isInstanceOfSatisfying(
            TaskflowException.class, e -> assertThat(e.code()).isEqualTo("page.invalid_cursor"));
    assertThat(c.cols()).isNotEmpty();
  }

  @Test
  void aGroupValueNeedsAGrouping() {
    assertThatThrownBy(() -> sql(ViewConfig.empty(), "todo", null))
        .isInstanceOfSatisfying(
            TaskflowException.class,
            e -> assertThat(e.code()).isEqualTo("view.invalid_group_value"));
  }
}
