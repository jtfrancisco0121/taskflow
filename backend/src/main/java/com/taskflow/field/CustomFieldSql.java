package com.taskflow.field;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.LocationInfo;
import com.taskflow.workspace.LocationTree;
import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.jooq.Condition;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * The jOOQ builders for custom field predicates, sort keys and group keys (AD-1): the one place
 * that knows how a type's value is read out of {@code task.custom} and which operators it has
 * (field-types.md). {@code view} and the MCP search call it; neither parses a custom value itself.
 *
 * <p>Every expression carries the scope guard: a value counts only when the task's List path is
 * under the field's defining Location and not under a Location that hides the field (paths are
 * resolved in Java and bound as values). Outside that scope the value is empty: a filter does not
 * match it, a sort puts it last, a group puts it in the empty group, as reads omit it. Everything
 * is built with bind values only.
 */
@Component
public class CustomFieldSql {

  private static final Set<FieldType> SORTABLE =
      Set.of(
          FieldType.TEXT,
          FieldType.NUMBER,
          FieldType.DATE,
          FieldType.DROPDOWN,
          FieldType.CHECKBOX,
          FieldType.URL,
          FieldType.EMAIL,
          FieldType.RATING,
          FieldType.PROGRESS);
  private static final Set<FieldType> GROUPABLE =
      Set.of(
          FieldType.DATE,
          FieldType.DROPDOWN,
          FieldType.CHECKBOX,
          FieldType.RATING,
          FieldType.PEOPLE);

  /** A field with the paths its scope guard needs, resolved once per request. */
  public record Bound(FieldInfo field, String definedAtPath, List<String> hidingPaths) {}

  /** A grouping: the key, its display label and the columns that order the groups. */
  public record Group(
      Field<String> key,
      Field<String> label,
      List<Field<?>> order,
      /** A join that expands one task into one row per group (People), or null. */
      org.jooq.Table<?> join) {
    public Group(Field<String> key, Field<String> label, List<Field<?>> order) {
      this(key, label, order, null);
    }
  }

  private final JdbcTemplate jdbc;
  private final LocationTree tree;

  CustomFieldSql(JdbcTemplate jdbc, LocationTree tree) {
    this.jdbc = jdbc;
    this.tree = tree;
  }

  public static boolean sortable(FieldType type) {
    return SORTABLE.contains(type);
  }

  public static boolean groupable(FieldType type) {
    return GROUPABLE.contains(type);
  }

  /** Resolves the scope guard paths of a field: where it is defined and where it is hidden. */
  public Bound bind(FieldInfo field) {
    String defined = tree.find(field.definedAt()).map(LocationInfo::path).orElse(null);
    List<String> hiding = new ArrayList<>();
    for (UUID at :
        jdbc.queryForList(
            "SELECT location_id FROM custom_field_hidden WHERE field_id = ?",
            UUID.class,
            field.id())) {
      tree.find(at).ifPresent(l -> hiding.add(l.path()));
    }
    return new Bound(field, defined, hiding);
  }

  // ---------------------------------------------------------------- validation

  /** Operators per type (field-types.md); an unknown operator or a bad value is a 400. */
  public static Set<String> operators(FieldType type) {
    return switch (type) {
      case TEXT, LONG_TEXT, URL, EMAIL -> Set.of("contains", "not_contains", "is_set", "is_empty");
      case NUMBER -> Set.of("eq", "neq", "gt", "gte", "lt", "lte", "between", "is_set", "is_empty");
      case DATE -> Set.of("before", "after", "on", "between", "is_set", "is_empty");
      case DROPDOWN -> Set.of("any_of", "none_of", "is_set", "is_empty");
      case LABELS, PEOPLE -> Set.of("any_of", "all_of", "none_of", "is_set", "is_empty");
      case CHECKBOX -> Set.of("is_checked", "is_unchecked");
      case RATING -> Set.of("eq", "gte", "lte", "is_set", "is_empty");
      case PROGRESS -> Set.of("gte", "lte", "between", "is_set", "is_empty");
    };
  }

  /** Throws {@code invalid.apply(message)} when the operator or the value does not fit the type. */
  public static void validateCondition(
      FieldInfo f, String op, JsonNode v, Function<String, TaskflowException> invalid) {
    if (op == null || !operators(f.type()).contains(op)) {
      throw invalid.apply("Operator " + op + " is not valid for " + f.name());
    }
    boolean none = v == null || v.isNull();
    switch (op) {
      case "is_set", "is_empty", "is_checked", "is_unchecked" -> {
        if (!none) {
          throw invalid.apply("This operator takes no value");
        }
      }
      case "contains", "not_contains" -> {
        if (none || !v.isTextual() || v.asText().isBlank() || v.asText().length() > 200) {
          throw invalid.apply("A text value is required for " + f.name());
        }
      }
      case "eq", "neq", "gt", "gte", "lt", "lte" -> {
        if (none || !v.isNumber()) {
          throw invalid.apply("A number is required for " + f.name());
        }
      }
      case "between" -> {
        if (none
            || !v.isArray()
            || v.size() != 2
            || !(f.type() == FieldType.DATE
                ? v.get(0).isTextual() && v.get(1).isTextual()
                : v.get(0).isNumber() && v.get(1).isNumber())) {
          throw invalid.apply("between takes two values for " + f.name());
        }
      }
      case "before", "after", "on" -> {
        if (none || !v.isTextual()) {
          throw invalid.apply("A day is required for " + f.name());
        }
      }
      case "any_of", "all_of", "none_of" -> {
        if (none || !v.isArray() || v.isEmpty() || v.size() > 50) {
          throw invalid.apply("A list of values is required for " + f.name());
        }
        for (JsonNode n : v) {
          if (!n.isTextual()) {
            throw invalid.apply("Values for " + f.name() + " are text");
          }
        }
      }
      default -> throw invalid.apply("Unknown operator " + op);
    }
  }

  // ---------------------------------------------------------------- expressions

  private static Field<?> custom(String taskAlias) {
    return DSL.field(DSL.name(taskAlias, "custom"));
  }

  /** The raw text of the stored value (null when absent), unguarded. */
  private static Field<String> text(Bound b, String taskAlias) {
    return DSL.field(
        "{0} ->> {1}", String.class, custom(taskAlias), DSL.val(b.field().id().toString()));
  }

  /** The scope guard: the List path is under the defining Location and not under a hide. */
  private static Condition guard(Bound b, String pathExpr) {
    Field<Object> path = DSL.field(pathExpr);
    Condition c = DSL.falseCondition();
    if (b.definedAtPath() != null) {
      c = DSL.condition("{0} <@ CAST({1} AS ltree)", path, DSL.val(b.definedAtPath()));
    }
    if (!b.hidingPaths().isEmpty()) {
      String array = b.hidingPaths().stream().collect(Collectors.joining(",", "{", "}"));
      c = c.and(DSL.condition("NOT ({0} <@ ANY (CAST({1} AS ltree[])))", path, DSL.val(array)));
    }
    return c;
  }

  private static Condition contains(Bound b, String taskAlias, String json) {
    return DSL.condition("{0} @> CAST({1} AS jsonb)", custom(taskAlias), DSL.val(json));
  }

  private static String keyed(Bound b, Object value) {
    // {"<fieldId>": <value>} with the value already JSON text
    return "{\"" + b.field().id() + "\": " + value + "}";
  }

  private static String quoted(String s) {
    return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }

  private static Field<BigDecimal> number(Bound b, String taskAlias) {
    return DSL.field("CAST({0} AS numeric)", BigDecimal.class, text(b, taskAlias));
  }

  private static Field<OffsetDateTime> date(Bound b, String taskAlias) {
    return DSL.field("CAST({0} AS timestamptz)", OffsetDateTime.class, text(b, taskAlias));
  }

  /** A condition for a filter node. {@code me} resolves the "me" value of People filters. */
  public Condition filter(
      Bound b,
      String op,
      JsonNode v,
      UUID me,
      Function<String, Instant[]> days,
      String taskAlias,
      String pathExpr) {
    FieldInfo f = b.field();
    boolean negate =
        switch (op) {
          case "is_empty", "is_unchecked", "not_contains", "neq", "none_of" -> true;
          default -> false;
        };
    Condition positive =
        switch (op) {
          case "is_set", "is_empty" -> set(b, taskAlias);
          case "is_checked", "is_unchecked" -> contains(b, taskAlias, keyed(b, "true"));
          case "contains", "not_contains" -> textMatch(b, taskAlias, v.asText());
          case "eq", "neq" -> compare(b, taskAlias, "=", v);
          case "gt" -> compare(b, taskAlias, ">", v);
          case "gte" -> compare(b, taskAlias, ">=", v);
          case "lt" -> compare(b, taskAlias, "<", v);
          case "lte" -> compare(b, taskAlias, "<=", v);
          case "between" -> between(b, taskAlias, v, days);
          case "before" -> date(b, taskAlias).lt(utc(days.apply(v.asText())[0]));
          case "after" -> date(b, taskAlias).ge(utc(days.apply(v.asText())[1]));
          case "on" -> {
            Instant[] r = days.apply(v.asText());
            yield date(b, taskAlias).ge(utc(r[0])).and(date(b, taskAlias).lt(utc(r[1])));
          }
          case "any_of", "none_of" -> anyOf(b, taskAlias, optionIds(f, v, me));
          case "all_of" -> allOf(b, taskAlias, optionIds(f, v, me));
          default ->
              throw TaskflowException.badRequest(
                  "view.invalid_config", "Unknown operator " + op + " for " + f.name());
        };
    // In scope AND the predicate holds; NULL (an empty value) counts as false, so a negated
    // operator matches empty and out-of-scope values instead of dropping them (three-valued logic).
    Condition holds = DSL.condition("coalesce(({0}), false)", guard(b, pathExpr).and(positive));
    return negate ? holds.not() : holds;
  }

  /** The value is present, live (an Option that still exists) and of the field's shape. */
  private Condition set(Bound b, String taskAlias) {
    FieldInfo f = b.field();
    return switch (f.type()) {
      case DROPDOWN -> {
        List<String> live = f.options().stream().map(o -> o.id().toString()).toList();
        yield live.isEmpty() ? DSL.falseCondition() : text(b, taskAlias).in(live);
      }
      case LABELS -> {
        List<Condition> any = new ArrayList<>();
        for (OptionInfo o : f.options()) {
          any.add(contains(b, taskAlias, keyed(b, "[" + quoted(o.id().toString()) + "]")));
        }
        yield any.isEmpty() ? DSL.falseCondition() : DSL.or(any);
      }
      case CHECKBOX -> contains(b, taskAlias, keyed(b, "true"));
      case PEOPLE ->
          DSL.condition(
              "coalesce(jsonb_array_length(CASE WHEN jsonb_typeof({0} -> {1}) = 'array' THEN {0} ->"
                  + " {1} END), 0) > 0",
              custom(taskAlias), DSL.val(b.field().id().toString()));
      default -> text(b, taskAlias).isNotNull();
    };
  }

  private static Condition textMatch(Bound b, String taskAlias, String needle) {
    return text(b, taskAlias).containsIgnoreCase(needle);
  }

  private static Condition compare(Bound b, String taskAlias, String op, JsonNode v) {
    return DSL.condition(
        "{0} " + op + " {1}", number(b, taskAlias), DSL.val(v.decimalValue(), BigDecimal.class));
  }

  private static Condition between(
      Bound b, String taskAlias, JsonNode v, Function<String, Instant[]> days) {
    if (b.field().type() == FieldType.DATE) {
      Instant from = days.apply(v.get(0).asText())[0];
      Instant to = days.apply(v.get(1).asText())[1];
      return date(b, taskAlias).ge(utc(from)).and(date(b, taskAlias).lt(utc(to)));
    }
    return number(b, taskAlias)
        .ge(v.get(0).decimalValue())
        .and(number(b, taskAlias).le(v.get(1).decimalValue()));
  }

  /**
   * Option ids named by ids or names (ignoring case) that are live; unknown values match nothing.
   */
  private static List<String> optionIds(FieldInfo f, JsonNode v, UUID me) {
    List<String> out = new ArrayList<>();
    if (f.type() == FieldType.PEOPLE) {
      // People values are user ids; "me" is the caller.
      for (JsonNode n : v) {
        String s = n.asText().trim();
        if (s.equalsIgnoreCase("me")) {
          out.add(me.toString());
        } else {
          try {
            out.add(UUID.fromString(s).toString());
          } catch (IllegalArgumentException e) {
            // not a user id: matches nobody
          }
        }
      }
      return out;
    }
    for (JsonNode n : v) {
      String s = n.asText().trim();
      Optional<OptionInfo> match =
          f.options().stream()
              .filter(o ->
                  o.id().toString().equalsIgnoreCase(s)
                      || o.name().toLowerCase(Locale.ROOT).equals(s.toLowerCase(Locale.ROOT)))
              .findFirst();
      match.ifPresent(o -> out.add(o.id().toString()));
    }
    return out;
  }

  private static Condition anyOf(Bound b, String taskAlias, List<String> ids) {
    if (ids.isEmpty()) {
      return DSL.falseCondition();
    }
    List<Condition> any = new ArrayList<>();
    for (String id : ids) {
      any.add(
          b.field().type() == FieldType.DROPDOWN
              ? contains(b, taskAlias, keyed(b, quoted(id)))
              : contains(b, taskAlias, keyed(b, "[" + quoted(id) + "]")));
    }
    return DSL.or(any);
  }

  private static Condition allOf(Bound b, String taskAlias, List<String> ids) {
    if (ids.isEmpty()) {
      return DSL.falseCondition();
    }
    List<Condition> all = new ArrayList<>();
    for (String id : ids) {
      all.add(contains(b, taskAlias, keyed(b, "[" + quoted(id) + "]")));
    }
    return DSL.and(all);
  }

  // ---------------------------------------------------------------- sort

  /**
   * The typed sort key; null outside the scope or when empty, so it sorts last in both directions.
   */
  public Field<?> sortKey(Bound b, String taskAlias, String pathExpr) {
    Condition g = guard(b, pathExpr);
    FieldInfo f = b.field();
    return switch (f.type()) {
      case NUMBER, RATING, PROGRESS ->
          DSL.case_().when(g, number(b, taskAlias)).else_(DSL.inline((BigDecimal) null));
      case DATE -> DSL.case_().when(g, date(b, taskAlias)).else_(DSL.inline((OffsetDateTime) null));
      case DROPDOWN -> {
        var choose = DSL.choose(text(b, taskAlias));
        org.jooq.CaseValueStep<String> step = choose;
        org.jooq.CaseWhenStep<String, Integer> when = null;
        for (int i = 0; i < f.options().size(); i++) {
          String id = f.options().get(i).id().toString();
          when = when == null ? step.when(id, i) : when.when(id, i);
        }
        yield when == null
            ? DSL.inline((Integer) null)
            : DSL.case_().when(g, when.else_(DSL.inline((Integer) null)));
      }
      case CHECKBOX ->
          DSL.case_()
              .when(g.and(contains(b, taskAlias, keyed(b, "true"))), 0)
              .when(g, 1)
              .else_(DSL.inline((Integer) null));
      default -> // TEXT, URL, EMAIL: case-insensitive text
          DSL.case_()
              .when(g.and(text(b, taskAlias).isNotNull()), DSL.lower(text(b, taskAlias)))
              .else_(DSL.inline((String) null));
    };
  }

  // ---------------------------------------------------------------- group

  /** The grouping of a field; the empty group has the key {@code none} and sorts last. */
  public Group group(Bound b, String taskAlias, String pathExpr, LocalDate today) {
    Condition g = guard(b, pathExpr);
    FieldInfo f = b.field();
    return switch (f.type()) {
      case DROPDOWN -> {
        List<String> live = f.options().stream().map(o -> o.id().toString()).toList();
        Field<String> raw =
            live.isEmpty()
                ? DSL.inline((String) null)
                : DSL.case_()
                    .when(g.and(text(b, taskAlias).in(live)), text(b, taskAlias))
                    .else_(DSL.inline((String) null));
        Field<String> key = DSL.coalesce(raw, DSL.inline("none"));
        Field<String> label = DSL.coalesce(optionLabel(f, raw), DSL.inline("None"));
        yield new Group(key, label, List.of(optionOrder(f, raw)));
      }
      case CHECKBOX -> {
        Field<String> key =
            DSL.case_()
                .when(g.and(contains(b, taskAlias, keyed(b, "true"))), DSL.inline("checked"))
                .else_(DSL.inline("unchecked"));
        Field<String> label =
            DSL.case_()
                .when(g.and(contains(b, taskAlias, keyed(b, "true"))), DSL.inline("Checked"))
                .else_(DSL.inline("Unchecked"));
        Field<Integer> order =
            DSL.case_()
                .when(g.and(contains(b, taskAlias, keyed(b, "true"))), DSL.inline(0))
                .else_(DSL.inline(1));
        yield new Group(key, label, List.of(order));
      }
      case RATING -> {
        Field<String> raw =
            DSL.case_()
                .when(g.and(text(b, taskAlias).isNotNull()), text(b, taskAlias))
                .else_(DSL.inline((String) null));
        Field<String> key = DSL.coalesce(raw, DSL.inline("none"));
        Field<Integer> order =
            DSL.coalesce(DSL.field("CAST({0} AS integer)", Integer.class, raw), DSL.inline(999));
        yield new Group(key, key, List.of(order));
      }
      case DATE -> dateGroup(b, taskAlias, g, today);
      case PEOPLE -> peopleGroup(b, taskAlias, g);
      default ->
          throw TaskflowException.badRequest(
              "view.invalid_config", f.name() + " cannot be used to group");
    };
  }

  private static Field<String> optionLabel(FieldInfo f, Field<String> raw) {
    org.jooq.CaseValueStep<String> step = DSL.choose(raw);
    org.jooq.CaseWhenStep<String, String> when = null;
    for (OptionInfo o : f.options()) {
      when =
          when == null
              ? step.when(o.id().toString(), o.name())
              : when.when(o.id().toString(), o.name());
    }
    return when == null ? DSL.inline((String) null) : when.else_(DSL.inline((String) null));
  }

  private static Field<Integer> optionOrder(FieldInfo f, Field<String> raw) {
    org.jooq.CaseValueStep<String> step = DSL.choose(raw);
    org.jooq.CaseWhenStep<String, Integer> when = null;
    for (int i = 0; i < f.options().size(); i++) {
      String id = f.options().get(i).id().toString();
      when = when == null ? step.when(id, i) : when.when(id, i);
    }
    return when == null ? DSL.inline(999) : when.else_(DSL.inline(999));
  }

  /**
   * One group per person: the array is expanded with a lateral join, so a task appears under each
   * person (like assignee); a task with nobody (or outside the scope) is under {@code none}.
   */
  private static Group peopleGroup(Bound b, String taskAlias, Condition g) {
    Field<?> array =
        DSL.field(
            "CASE WHEN {0} AND jsonb_typeof({1} -> {2}) = 'array' THEN {1} -> {2} END",
            g, custom(taskAlias), DSL.val(b.field().id().toString()));
    org.jooq.Table<?> join =
        DSL.lateral(DSL.table("jsonb_array_elements_text({0})", array)).as("gp", "person");
    Field<String> person = DSL.field(DSL.name("gp", "person"), String.class);
    Field<String> key = DSL.coalesce(person, DSL.inline("none"));
    Field<Integer> order = DSL.case_().when(person.isNull(), 1).else_(0);
    return new Group(key, key, List.of(order), join);
  }

  private static Group dateGroup(Bound b, String taskAlias, Condition g, LocalDate today) {
    OffsetDateTime start = utc(today.atStartOfDay().toInstant(ZoneOffset.UTC));
    OffsetDateTime tomorrow = start.plusDays(1);
    OffsetDateTime weekEnd =
        utc(
            today
                .with(TemporalAdjusters.next(DayOfWeek.MONDAY))
                .atStartOfDay()
                .toInstant(ZoneOffset.UTC));
    Field<OffsetDateTime> d = date(b, taskAlias);
    Condition in = g.and(text(b, taskAlias).isNotNull());
    Field<String> key =
        DSL.case_()
            .when(in.not(), DSL.inline("none"))
            .when(d.lt(start), DSL.inline("overdue"))
            .when(d.lt(tomorrow), DSL.inline("today"))
            .when(d.lt(weekEnd), DSL.inline("this_week"))
            .else_(DSL.inline("later"));
    Field<Integer> order =
        DSL.case_()
            .when(in.not(), DSL.inline(4))
            .when(d.lt(start), DSL.inline(0))
            .when(d.lt(tomorrow), DSL.inline(1))
            .when(d.lt(weekEnd), DSL.inline(2))
            .else_(DSL.inline(3));
    return new Group(key, key, List.of(order));
  }

  /**
   * A day value as the UTC range [start, end): a calendar day, or today, the week (Monday to
   * Sunday) or the next 7 days. The same rule as the built-in date filters.
   */
  public static Instant[] dayRange(String value, LocalDate today) {
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
        try {
          from = LocalDate.parse(value);
        } catch (java.time.format.DateTimeParseException e) {
          throw TaskflowException.badRequest(
              "view.invalid_config", "Days are YYYY-MM-DD or today, this_week, next_7_days");
        }
        to = from.plusDays(1);
      }
    }
    return new Instant[] {
      from.atStartOfDay().toInstant(ZoneOffset.UTC), to.atStartOfDay().toInstant(ZoneOffset.UTC)
    };
  }

  /**
   * Throws when a Dropdown, Labels or People value names an Option that does not exist, listing the
   * valid ones (agents need the names; a saved view must keep working after an Option is retired,
   * so views do not call this).
   */
  public static void requireKnownOptions(
      FieldInfo f, JsonNode v, Function<String, TaskflowException> invalid) {
    if (v == null || !v.isArray() || !f.type().hasOptions()) {
      return;
    }
    List<String> names = f.options().stream().map(OptionInfo::name).toList();
    for (JsonNode n : v) {
      String s = n.asText().trim();
      boolean known =
          f.options().stream()
              .anyMatch(o -> o.id().toString().equalsIgnoreCase(s) || o.name().equalsIgnoreCase(s));
      if (!known) {
        throw invalid.apply(
            f.name() + " has no option '" + s + "'. Pick one of: " + String.join(", ", names));
      }
    }
  }

  private static OffsetDateTime utc(Instant i) {
    return OffsetDateTime.ofInstant(i, ZoneOffset.UTC);
  }
}
