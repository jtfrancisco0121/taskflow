package com.taskflow.automation.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.automation.internal.RuleDocs.Action;
import com.taskflow.automation.internal.RuleDocs.Condition;
import com.taskflow.automation.internal.RuleDocs.Trigger;
import com.taskflow.identity.UserDirectory;
import com.taskflow.identity.UserInfo;
import com.taskflow.shared.Actor;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.Ids;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.LocationAccess;
import com.taskflow.workspace.LocationInfo;
import com.taskflow.workspace.LocationTree;
import com.taskflow.workspace.Permissions;
import com.taskflow.workspace.Role;
import com.taskflow.workspace.WorkspaceQuery;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Rule CRUD at a Location (CAP-1, FR-1..4). Writes need Location EDIT, reads Location VIEW. Every
 * write bumps the version, is checked against {@code If-Match} and records an {@code automation.*}
 * event through EventRecorder.
 */
@Service
class AutomationRuleService {

  record Person(UUID id, String name) {}

  /** The newest run of a rule among the tasks the viewer can see. */
  record LastRun(String status, String reason, Instant at, UUID taskId) {}

  record RuleView(
      UUID id,
      UUID locationId,
      String name,
      boolean enabled,
      Trigger trigger,
      List<Condition> conditions,
      List<Action> actions,
      long version,
      UUID definedAt,
      String definedAtName,
      boolean inherited,
      Person createdBy,
      Instant createdAt,
      Instant updatedAt,
      LastRun lastRun) {}

  record RuleListView(UUID locationId, boolean canEdit, int limit, List<RuleView> rules) {}

  record CreateInput(
      String name,
      Boolean enabled,
      Trigger trigger,
      List<Condition> conditions,
      List<Action> actions) {}

  /** Merge patch: null means unchanged. */
  record UpdateInput(
      String name,
      Boolean enabled,
      Trigger trigger,
      List<Condition> conditions,
      List<Action> actions) {}

  record Row(
      UUID id,
      UUID workspaceId,
      UUID locationId,
      String name,
      boolean enabled,
      String trigger,
      String conditions,
      String actions,
      long version,
      UUID createdBy,
      Instant createdAt,
      Instant updatedAt) {}

  private final JdbcTemplate jdbc;
  private final NamedParameterJdbcTemplate named;
  private final ObjectMapper mapper;
  private final LocationTree tree;
  private final Permissions permissions;
  private final EventRecorder events;
  private final RuleValidator validator;
  private final WorkspaceQuery workspaces;
  private final UserDirectory users;
  private final int limit;

  AutomationRuleService(
      JdbcTemplate jdbc,
      NamedParameterJdbcTemplate named,
      ObjectMapper mapper,
      LocationTree tree,
      Permissions permissions,
      EventRecorder events,
      RuleValidator validator,
      WorkspaceQuery workspaces,
      UserDirectory users,
      @Value("${taskflow.automation.limit:50}") int limit) {
    this.jdbc = jdbc;
    this.named = named;
    this.mapper = mapper;
    this.tree = tree;
    this.permissions = permissions;
    this.events = events;
    this.validator = validator;
    this.workspaces = workspaces;
    this.users = users;
    this.limit = limit;
  }

  // ---------------------------------------------------------------- reads

  @Transactional(readOnly = true)
  RuleListView list(UUID locationId) {
    LocationInfo location = location(locationId);
    permissions.require(Permissions.LOCATION, locationId, com.taskflow.workspace.Action.VIEW);
    UUID uid = CurrentActor.userId();
    Role role = workspaces.roleOf(location.workspaceId(), uid).orElse(Role.GUEST);
    MapSqlParameterSource params =
        new MapSqlParameterSource(LocationAccess.params(uid, role))
            .addValue("ids", location.selfAndAncestorIds().toArray(new UUID[0]))
            .addValue("ws", location.workspaceId());
    List<Row> rows =
        named.query(
            "SELECT r.* FROM automation_rule r JOIN location l ON l.workspace_id = r.workspace_id"
                + " AND l.id = r.location_id WHERE r.workspace_id = :ws AND r.deleted_at IS NULL"
                + " AND r.location_id = ANY (:ids) AND "
                + LocationAccess.visible("l")
                + " ORDER BY nlevel(l.path), r.created_at, r.id",
            params,
            (rs, i) -> row(rs));
    return new RuleListView(locationId, canEdit(locationId), limit, views(rows, locationId));
  }

  @Transactional(readOnly = true)
  RuleView get(UUID ruleId) {
    Row row = live(ruleId);
    return views(List.of(row), null).get(0);
  }

  // ---------------------------------------------------------------- writes

  @Transactional
  RuleView create(UUID locationId, CreateInput in) {
    LocationInfo location = location(locationId);
    permissions.require(Permissions.LOCATION, locationId, com.taskflow.workspace.Action.EDIT);
    String name = RuleValidator.name(in.name());
    List<Condition> conditions = in.conditions() == null ? List.of() : in.conditions();
    List<Action> actions = in.actions() == null ? List.of() : in.actions();
    validator.validate(location.workspaceId(), locationId, in.trigger(), conditions, actions);
    // Serialise the limit check per Location so two creates cannot both take the last slot.
    jdbc.query("SELECT id FROM location WHERE id = ? FOR UPDATE", rs -> {}, locationId);
    int own =
        jdbc.queryForObject(
            "SELECT count(*) FROM automation_rule WHERE location_id = ? AND deleted_at IS NULL",
            Integer.class,
            locationId);
    if (own >= limit) {
      throw TaskflowException.badRequest(
          "automation.limit", "A location can have up to " + limit + " rules");
    }
    Actor actor = CurrentActor.require();
    UUID id = Ids.newId();
    jdbc.update(
        "INSERT INTO automation_rule (id, workspace_id, location_id, name, enabled, trigger,"
            + " conditions, actions, created_by, created_by_key_id) VALUES (?, ?, ?, ?, ?,"
            + " CAST(? AS jsonb), CAST(? AS jsonb), CAST(? AS jsonb), ?, ?)",
        id,
        location.workspaceId(),
        locationId,
        name,
        in.enabled() == null || in.enabled(),
        json(in.trigger()),
        json(conditions),
        json(actions),
        actor.id(),
        actor.keyId());
    record(location.workspaceId(), id, "automation.created", locationId, name, 1);
    return get(id);
  }

  @Transactional
  RuleView update(UUID ruleId, long expectedVersion, UpdateInput in) {
    Row seen = live(ruleId);
    permissions.require(
        Permissions.LOCATION, seen.locationId(), com.taskflow.workspace.Action.EDIT);
    jdbc.query("SELECT id FROM automation_rule WHERE id = ? FOR UPDATE", rs -> {}, ruleId);
    Row current = live(ruleId);
    if (current.version() != expectedVersion) {
      throw stale(current);
    }
    String name = in.name() == null ? current.name() : RuleValidator.name(in.name());
    Trigger trigger = in.trigger() == null ? parse(current.trigger(), Trigger.class) : in.trigger();
    List<Condition> conditions =
        in.conditions() == null
            ? parseList(current.conditions(), new TypeReference<List<Condition>>() {})
            : in.conditions();
    List<Action> actions =
        in.actions() == null
            ? parseList(current.actions(), new TypeReference<List<Action>>() {})
            : in.actions();
    boolean enabled = in.enabled() == null ? current.enabled() : in.enabled();
    boolean docsChanged = in.trigger() != null || in.conditions() != null || in.actions() != null;
    if (docsChanged) {
      validator.validate(current.workspaceId(), current.locationId(), trigger, conditions, actions);
    }
    boolean enabledChanged = enabled != current.enabled();
    boolean contentChanged = docsChanged || !name.equals(current.name());
    if (!enabledChanged && !contentChanged) {
      return get(ruleId);
    }
    jdbc.update(
        "UPDATE automation_rule SET name = ?, enabled = ?, trigger = CAST(? AS jsonb), conditions ="
            + " CAST(? AS jsonb), actions = CAST(? AS jsonb), version = version + 1, updated_at ="
            + " now() WHERE id = ?",
        name,
        enabled,
        json(trigger),
        json(conditions),
        json(actions),
        ruleId);
    String type =
        contentChanged
            ? "automation.updated"
            : enabled ? "automation.enabled" : "automation.disabled";
    record(current.workspaceId(), ruleId, type, current.locationId(), name, expectedVersion + 1);
    return get(ruleId);
  }

  @Transactional
  void delete(UUID ruleId, Long expectedVersion) {
    Row seen = live(ruleId);
    permissions.require(
        Permissions.LOCATION, seen.locationId(), com.taskflow.workspace.Action.EDIT);
    jdbc.query("SELECT id FROM automation_rule WHERE id = ? FOR UPDATE", rs -> {}, ruleId);
    Row current = live(ruleId);
    if (expectedVersion != null && current.version() != expectedVersion) {
      throw stale(current);
    }
    jdbc.update(
        "UPDATE automation_rule SET deleted_at = now(), version = version + 1, updated_at = now()"
            + " WHERE id = ?",
        ruleId);
    record(
        current.workspaceId(),
        ruleId,
        "automation.deleted",
        current.locationId(),
        current.name(),
        current.version() + 1);
  }

  // ---------------------------------------------------------------- helpers

  private void record(
      UUID workspaceId, UUID ruleId, String type, UUID locationId, String name, long version) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("locationId", locationId.toString());
    payload.put("name", name);
    payload.put("version", version);
    events.record(workspaceId, "automation", ruleId, type, payload);
  }

  private List<RuleView> views(List<Row> rows, UUID viewedLocation) {
    if (rows.isEmpty()) {
      return List.of();
    }
    Set<UUID> creators = new HashSet<>();
    rows.forEach(r -> creators.add(r.createdBy()));
    Map<UUID, UserInfo> people = users.byIds(creators);
    Map<UUID, LastRun> last = lastRuns(rows);
    List<RuleView> out = new ArrayList<>();
    Map<UUID, String> names = new HashMap<>();
    for (Row r : rows) {
      String definedAtName =
          names.computeIfAbsent(
              r.locationId(), id -> tree.find(id).map(LocationInfo::name).orElse(""));
      UserInfo creator = people.get(r.createdBy());
      out.add(
          new RuleView(
              r.id(),
              r.locationId(),
              r.name(),
              r.enabled(),
              parse(r.trigger(), Trigger.class),
              parseList(r.conditions(), new TypeReference<List<Condition>>() {}),
              parseList(r.actions(), new TypeReference<List<Action>>() {}),
              r.version(),
              r.locationId(),
              definedAtName,
              viewedLocation != null && !r.locationId().equals(viewedLocation),
              new Person(r.createdBy(), creator == null ? "Unknown" : creator.displayName()),
              r.createdAt(),
              r.updatedAt(),
              last.get(r.id())));
    }
    return out;
  }

  /** The newest run per rule among tasks whose home List the viewer can see (AD-8). */
  private Map<UUID, LastRun> lastRuns(List<Row> rows) {
    UUID ws = rows.get(0).workspaceId();
    UUID uid = CurrentActor.userId();
    Role role = workspaces.roleOf(ws, uid).orElse(Role.GUEST);
    MapSqlParameterSource params =
        new MapSqlParameterSource(LocationAccess.params(uid, role))
            .addValue("ids", rows.stream().map(Row::id).toArray(UUID[]::new));
    Map<UUID, LastRun> out = new HashMap<>();
    named.query(
        "SELECT DISTINCT ON (r.rule_id) r.rule_id, r.status, r.reason, r.created_at, r.task_id FROM"
            + " automation_run r JOIN task t ON t.workspace_id = r.workspace_id AND t.id ="
            + " r.task_id JOIN location l ON l.id = t.list_id WHERE r.rule_id = ANY (:ids) AND "
            + LocationAccess.visible("l")
            + " ORDER BY r.rule_id, r.created_at DESC, r.id DESC",
        params,
        rs -> {
          out.put(
              rs.getObject("rule_id", UUID.class),
              new LastRun(
                  rs.getString("status"),
                  rs.getString("reason"),
                  rs.getTimestamp("created_at").toInstant(),
                  rs.getObject("task_id", UUID.class)));
        });
    return out;
  }

  private TaskflowException stale(Row current) {
    return TaskflowException.conflict(
            "automation.stale", "Someone else changed this rule. Review and save again.")
        .with("current", views(List.of(current), null).get(0))
        .with("version", current.version());
  }

  Row live(UUID ruleId) {
    return find(ruleId)
        .orElseThrow(
            () -> TaskflowException.notFound("automation.not_found", "Automation not found"));
  }

  Optional<Row> find(UUID ruleId) {
    return jdbc
        .query(
            "SELECT * FROM automation_rule WHERE id = ? AND deleted_at IS NULL",
            (rs, i) -> row(rs),
            ruleId)
        .stream()
        .findFirst();
  }

  static Row row(java.sql.ResultSet rs) throws java.sql.SQLException {
    return new Row(
        rs.getObject("id", UUID.class),
        rs.getObject("workspace_id", UUID.class),
        rs.getObject("location_id", UUID.class),
        rs.getString("name"),
        rs.getBoolean("enabled"),
        rs.getString("trigger"),
        rs.getString("conditions"),
        rs.getString("actions"),
        rs.getLong("version"),
        rs.getObject("created_by", UUID.class),
        rs.getTimestamp("created_at").toInstant(),
        rs.getTimestamp("updated_at").toInstant());
  }

  private boolean canEdit(UUID locationId) {
    try {
      permissions.require(Permissions.LOCATION, locationId, com.taskflow.workspace.Action.EDIT);
      return true;
    } catch (TaskflowException e) {
      return false;
    }
  }

  private LocationInfo location(UUID id) {
    return tree.find(id)
        .filter(l -> !l.deleted())
        .orElseThrow(() -> TaskflowException.notFound("location.not_found", "Location not found"));
  }

  <T> T parse(String json, Class<T> type) {
    try {
      return mapper.readValue(json, type);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("stored rule document is invalid", e);
    }
  }

  <T> List<T> parseList(String json, TypeReference<List<T>> type) {
    try {
      return mapper.readValue(json, type);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("stored rule document is invalid", e);
    }
  }

  private String json(Object value) {
    try {
      return mapper.writeValueAsString(value);
    } catch (JsonProcessingException e) {
      throw new IllegalArgumentException("not serializable", e);
    }
  }
}
