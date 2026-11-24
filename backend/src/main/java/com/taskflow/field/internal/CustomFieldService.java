package com.taskflow.field.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.field.FieldInfo;
import com.taskflow.field.FieldType;
import com.taskflow.field.OptionInfo;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.Ids;
import com.taskflow.shared.RankAllocator;
import com.taskflow.shared.RankService;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.Action;
import com.taskflow.workspace.LocationInfo;
import com.taskflow.workspace.LocationTree;
import com.taskflow.workspace.Permissions;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Custom field definitions: create, edit, retire, hide and unhide (CAP-1..3). Rows are never
 * deleted and a type never changes (AD-3); every write serialises per Workspace (AD-5), checks the
 * branch-wide name rule and the limits, bumps the version (AD-6) and records its events (AD-7).
 */
@Service
class CustomFieldService {

  static final int MAX_OWN_FIELDS = 50;
  static final int MAX_EFFECTIVE_FIELDS = 100;
  static final int MAX_OPTIONS = 200;
  static final int MAX_NAME = 50;
  static final List<String> PALETTE =
      List.of(
          "gray", "red", "orange", "amber", "green", "teal", "blue", "indigo", "purple", "pink");

  /** A field as the API shows it for one location. */
  record FieldView(
      UUID id,
      String name,
      FieldType type,
      Map<String, Object> config,
      List<OptionInfo> options,
      UUID definedAt,
      String definedAtName,
      boolean inherited,
      boolean hidden,
      long version) {}

  record FieldListView(UUID locationId, boolean canEdit, List<FieldView> fields) {}

  /** One Option of a create or update request; {@code id} is set for an Option that is kept. */
  record OptionDraft(UUID id, String name, String color) {}

  record CreateInput(
      String name, String type, Map<String, Object> config, List<OptionDraft> options) {}

  record UpdateInput(
      String name,
      String type,
      Map<String, Object> config,
      List<OptionDraft> options,
      UUID beforeId,
      UUID afterId) {}

  private final JdbcTemplate jdbc;
  private final FieldCatalogImpl catalog;
  private final LocationTree tree;
  private final EventRecorder events;
  private final Permissions permissions;
  private final FieldLock lock;
  private final RankAllocator ranks;
  private final ObjectMapper mapper;

  CustomFieldService(
      JdbcTemplate jdbc,
      FieldCatalogImpl catalog,
      LocationTree tree,
      EventRecorder events,
      Permissions permissions,
      FieldLock lock,
      RankAllocator ranks,
      ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.catalog = catalog;
    this.tree = tree;
    this.events = events;
    this.permissions = permissions;
    this.lock = lock;
    this.ranks = ranks;
    this.mapper = mapper;
  }

  // ---------------------------------------------------------------- reads

  @Transactional(readOnly = true)
  FieldListView list(UUID locationId) {
    LocationInfo location = location(locationId);
    List<FieldView> fields = new ArrayList<>();
    for (FieldCatalogImpl.Scoped s : catalog.scoped(location)) {
      // Fields hidden by an ancestor are not part of this location at all; its own hides show.
      if (s.hiddenAt() == null || s.hiddenAt().equals(location.id())) {
        fields.add(view(s.field(), location.id(), s.hiddenAt() != null));
      }
    }
    return new FieldListView(locationId, canEdit(locationId), fields);
  }

  @Transactional(readOnly = true)
  FieldView get(UUID fieldId) {
    return view(live(fieldId), null, false);
  }

  // ---------------------------------------------------------------- writes

  @Transactional
  FieldView create(UUID locationId, CreateInput in) {
    LocationInfo location = location(locationId);
    FieldType type = type(in.type());
    if (type == FieldType.PEOPLE) {
      // Built in 3A S8: the column CHECK already allows it, the API does not yet.
      throw TaskflowException.badRequest(
          "field.invalid_type", "The People field type is not available yet");
    }
    String name = cleanName(in.name());
    Map<String, Object> config = config(type, in.config());
    List<OptionDraft> options = options(type, in.options(), Set.of(), null);
    lock.lockLocation(locationId);
    lock.lock(location.workspaceId());
    nameFree(location, name, null);
    int own =
        jdbc.queryForObject(
            "SELECT count(*) FROM custom_field WHERE location_id = ? AND retired_at IS NULL",
            Integer.class,
            locationId);
    if (own >= MAX_OWN_FIELDS) {
      throw TaskflowException.badRequest(
          "field.limit", "A location can define up to " + MAX_OWN_FIELDS + " fields.");
    }
    if (catalog.scoped(location).size() >= MAX_EFFECTIVE_FIELDS) {
      throw TaskflowException.badRequest(
          "field.limit", "A location can have up to " + MAX_EFFECTIVE_FIELDS + " fields.");
    }
    UUID id = Ids.newId();
    String rank =
        ranks.append(
            new RankAllocator.Scope(
                "custom_field", "location_id = ? AND retired_at IS NULL", locationId));
    jdbc.update(
        "INSERT INTO custom_field (id, workspace_id, location_id, name, type, config, rank,"
            + " created_by) VALUES (?, ?, ?, ?, ?, CAST(? AS jsonb), ?, ?)",
        id,
        location.workspaceId(),
        locationId,
        name,
        type.name(),
        json(config),
        rank,
        CurrentActor.userId());
    if (type.hasOptions()) {
      writeOptions(location.workspaceId(), id, List.of(), options);
    }
    changed(location, id, "custom_field.created");
    return view(live(id), null, false);
  }

  @Transactional
  FieldView update(UUID fieldId, long expectedVersion, UpdateInput in) {
    FieldInfo seen = live(fieldId);
    permissions.require(Permissions.LOCATION, seen.definedAt(), Action.EDIT);
    LocationInfo location = location(seen.definedAt());
    lock.lockLocation(location.id());
    lock.lock(location.workspaceId());
    FieldInfo current = live(fieldId);
    if (current.version() != expectedVersion) {
      throw stale(current);
    }
    if (in.type() != null && type(in.type()) != current.type()) {
      throw TaskflowException.badRequest(
          "field.type_immutable", "The type can't change after creation");
    }
    boolean changed = false;
    String name = current.name();
    if (in.name() != null) {
      name = cleanName(in.name());
      if (!name.equals(current.name())) {
        nameFree(location, name, fieldId);
        changed = true;
      }
    }
    Map<String, Object> config = current.config();
    if (in.config() != null) {
      config = config(current.type(), in.config());
      changed |= !config.equals(current.config());
    }
    List<OptionDraft> options = null;
    if (in.options() != null) {
      Set<UUID> liveIds = new HashSet<>();
      current.options().forEach(o -> liveIds.add(o.id()));
      options = options(current.type(), in.options(), liveIds, current.options());
      changed |= !sameOptions(current.options(), options);
    }
    String rank = null;
    if (in.beforeId() != null || in.afterId() != null) {
      rank =
          ranks.place(
              new RankAllocator.Scope(
                  "custom_field", "location_id = ? AND retired_at IS NULL", location.id()),
              fieldId,
              in.beforeId(),
              in.afterId());
      changed |= !rank.equals(rankOf(fieldId));
    }
    if (!changed) {
      return view(current, null, false);
    }
    if (options != null) {
      writeOptions(location.workspaceId(), fieldId, current.options(), options);
    }
    jdbc.update(
        "UPDATE custom_field SET name = ?, config = CAST(? AS jsonb), rank = COALESCE(?, rank),"
            + " version = version + 1, updated_at = now() WHERE id = ?",
        name,
        json(config),
        rank,
        fieldId);
    changed(location, fieldId, "custom_field.updated");
    return view(live(fieldId), null, false);
  }

  /** Retires the field: its values stay in the tasks, reads and filters stop showing them. */
  @Transactional
  void retire(UUID fieldId, long expectedVersion) {
    FieldInfo seen = live(fieldId);
    permissions.require(Permissions.LOCATION, seen.definedAt(), Action.EDIT);
    LocationInfo location = location(seen.definedAt());
    lock.lockLocation(location.id());
    lock.lock(location.workspaceId());
    FieldInfo current = live(fieldId);
    if (current.version() != expectedVersion) {
      throw stale(current);
    }
    jdbc.update(
        "UPDATE custom_field SET retired_at = now(), version = version + 1, updated_at = now()"
            + " WHERE id = ?",
        fieldId);
    changed(location, fieldId, "custom_field.retired");
  }

  /** Hides a field defined at a strict ancestor for this location's subtree. */
  @Transactional
  FieldListView hide(UUID locationId, UUID fieldId) {
    LocationInfo location = location(locationId);
    lock.lockLocation(locationId);
    lock.lock(location.workspaceId());
    FieldInfo field = inheritedField(location, fieldId);
    int inserted =
        jdbc.update(
            "INSERT INTO custom_field_hidden (workspace_id, location_id, field_id) VALUES (?, ?, ?)"
                + " ON CONFLICT DO NOTHING",
            location.workspaceId(),
            locationId,
            field.id());
    if (inserted > 0) {
      changed(location, field.id(), "custom_field.hidden");
    }
    return list(locationId);
  }

  @Transactional
  FieldListView unhide(UUID locationId, UUID fieldId) {
    LocationInfo location = location(locationId);
    lock.lockLocation(locationId);
    lock.lock(location.workspaceId());
    int deleted =
        jdbc.update(
            "DELETE FROM custom_field_hidden WHERE location_id = ? AND field_id = ?",
            locationId,
            fieldId);
    if (deleted > 0) {
      changed(location, fieldId, "custom_field.unhidden");
    }
    return list(locationId);
  }

  // ---------------------------------------------------------------- rules

  private FieldInfo inheritedField(LocationInfo location, UUID fieldId) {
    FieldInfo field = live(fieldId);
    if (field.definedAt().equals(location.id())) {
      throw TaskflowException.badRequest(
          "field.hide_own", "A location can only hide fields it inherits; retire this one instead");
    }
    if (!location.selfAndAncestorIds().contains(field.definedAt())) {
      throw TaskflowException.notFound("field.not_found", "Field not found");
    }
    return field;
  }

  /**
   * One live field name per branch (AD-5): ancestors, the location itself and every descendant of
   * any type, archived and deleted included, so a restore cannot create a clash.
   */
  private void nameFree(LocationInfo location, String name, UUID exceptId) {
    Set<UUID> branch = new LinkedHashSet<>(location.selfAndAncestorIds());
    branch.addAll(tree.locationIdsAtOrUnder(location.id()));
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT f.name, l.name AS location_name FROM custom_field f JOIN location l ON l.id ="
                + " f.location_id WHERE f.workspace_id = ? AND f.retired_at IS NULL AND"
                + " lower(btrim(f.name)) = ? AND f.location_id = ANY (CAST(? AS uuid[])) AND f.id"
                + " IS DISTINCT FROM ? LIMIT 1",
            location.workspaceId(),
            name.toLowerCase(Locale.ROOT),
            FieldCatalogImpl.chain(new ArrayList<>(branch)),
            exceptId);
    if (!rows.isEmpty()) {
      throw TaskflowException.conflict(
              "field.name_taken",
              "'"
                  + name
                  + "' is already used on this branch (defined at "
                  + rows.get(0).get("location_name")
                  + ").")
          .with("name", name);
    }
  }

  private static String cleanName(String raw) {
    String name = raw == null ? "" : raw.trim();
    if (name.isEmpty() || name.length() > MAX_NAME) {
      throw TaskflowException.badRequest(
          "field.invalid_name", "A field name is 1 to " + MAX_NAME + " characters");
    }
    return name;
  }

  private static FieldType type(String raw) {
    if (raw == null) {
      throw TaskflowException.badRequest("field.invalid_type", "A field needs a type");
    }
    try {
      return FieldType.valueOf(raw.trim().toUpperCase(Locale.ROOT));
    } catch (IllegalArgumentException e) {
      throw TaskflowException.badRequest("field.invalid_type", "Unknown field type '" + raw + "'");
    }
  }

  /** Normalised config: only the keys a type knows, defaults filled in. */
  private static Map<String, Object> config(FieldType type, Map<String, Object> raw) {
    Map<String, Object> in = raw == null ? Map.of() : raw;
    Map<String, Object> out = new LinkedHashMap<>();
    switch (type) {
      case NUMBER -> {
        out.put("decimals", boundedInt(in, "decimals", 0, 0, 6));
        rejectOther(in, "decimals");
      }
      case RATING -> {
        out.put("max", boundedInt(in, "max", 5, 1, 10));
        rejectOther(in, "max");
      }
      default -> rejectOther(in);
    }
    return out;
  }

  private static int boundedInt(Map<String, Object> in, String key, int dflt, int min, int max) {
    Object v = in.get(key);
    if (v == null) {
      return dflt;
    }
    if (!(v instanceof Number n) || n.doubleValue() != Math.rint(n.doubleValue())) {
      throw TaskflowException.badRequest(
          "field.invalid_config", "'" + key + "' must be a whole number");
    }
    int value = n.intValue();
    if (value < min || value > max) {
      throw TaskflowException.badRequest(
          "field.invalid_config", "'" + key + "' must be between " + min + " and " + max);
    }
    return value;
  }

  private static void rejectOther(Map<String, Object> in, String... known) {
    Set<String> allowed = Set.of(known);
    for (String key : in.keySet()) {
      if (!allowed.contains(key)) {
        throw TaskflowException.badRequest(
            "field.invalid_config", "This field type has no setting '" + key + "'");
      }
    }
  }

  /** Validates an Options list: names 1-50 and unique ignoring case, ids must be live Options. */
  private List<OptionDraft> options(
      FieldType type, List<OptionDraft> drafts, Set<UUID> liveIds, List<OptionInfo> current) {
    if (drafts == null || drafts.isEmpty()) {
      return List.of();
    }
    if (!type.hasOptions()) {
      throw TaskflowException.badRequest(
          "field.invalid_config", "Only Dropdown and Labels fields have Options");
    }
    if (drafts.size() > MAX_OPTIONS) {
      throw TaskflowException.badRequest(
          "field.limit", "A field can have up to " + MAX_OPTIONS + " Options.");
    }
    Map<UUID, OptionInfo> byId = new LinkedHashMap<>();
    if (current != null) {
      current.forEach(o -> byId.put(o.id(), o));
    }
    Set<String> names = new HashSet<>();
    Set<UUID> ids = new HashSet<>();
    List<OptionDraft> out = new ArrayList<>(drafts.size());
    for (int i = 0; i < drafts.size(); i++) {
      OptionDraft d = drafts.get(i);
      String name = d.name() == null ? "" : d.name().trim();
      if (name.isEmpty() || name.length() > MAX_NAME) {
        throw TaskflowException.badRequest(
            "field.invalid_option", "Option names are 1 to " + MAX_NAME + " characters");
      }
      if (!names.add(name.toLowerCase(Locale.ROOT))) {
        throw TaskflowException.badRequest(
                "field.option_name_taken", "'" + name + "' is already an Option of this field")
            .with("name", name);
      }
      if (d.id() != null && (!liveIds.contains(d.id()) || !ids.add(d.id()))) {
        throw TaskflowException.badRequest(
            "field.unknown_option", "Option " + d.id() + " is not an Option of this field");
      }
      String color = d.color();
      if (color == null) {
        OptionInfo existing = d.id() == null ? null : byId.get(d.id());
        color = existing != null ? existing.color() : PALETTE.get(i % PALETTE.size());
      } else if (!PALETTE.contains(color)) {
        throw TaskflowException.badRequest(
            "field.invalid_option", "Option colors are one of " + String.join(", ", PALETTE));
      }
      out.add(new OptionDraft(d.id(), name, color));
    }
    return out;
  }

  private static boolean sameOptions(List<OptionInfo> current, List<OptionDraft> next) {
    if (current.size() != next.size()) {
      return false;
    }
    for (int i = 0; i < next.size(); i++) {
      OptionInfo c = current.get(i);
      OptionDraft n = next.get(i);
      if (!Objects.equals(c.id(), n.id())
          || !c.name().equals(n.name())
          || !c.color().equals(n.color())) {
        return false;
      }
    }
    return true;
  }

  /** Retires the Options that are gone, updates the kept ones, inserts the new ones, in order. */
  private void writeOptions(
      UUID workspaceId, UUID fieldId, List<OptionInfo> current, List<OptionDraft> next) {
    Set<UUID> kept = new HashSet<>();
    next.forEach(d -> {
      if (d.id() != null) {
        kept.add(d.id());
      }
    });
    for (OptionInfo o : current) {
      if (!kept.contains(o.id())) {
        jdbc.update("UPDATE custom_field_option SET retired_at = now() WHERE id = ?", o.id());
      }
    }
    // A retired Option's name is free again for a new one: names are only unique among live ones.
    List<String> ranks = RankService.spread(next.size());
    for (int i = 0; i < next.size(); i++) {
      OptionDraft d = next.get(i);
      if (d.id() != null) {
        jdbc.update(
            "UPDATE custom_field_option SET name = ?, color = ?, rank = ? WHERE id = ?",
            d.name(),
            d.color(),
            ranks.get(i),
            d.id());
      } else {
        jdbc.update(
            "INSERT INTO custom_field_option (id, workspace_id, field_id, name, color, rank)"
                + " VALUES (?, ?, ?, ?, ?, ?)",
            Ids.newId(),
            workspaceId,
            fieldId,
            d.name(),
            d.color(),
            ranks.get(i));
      }
    }
  }

  // ---------------------------------------------------------------- helpers

  private void changed(LocationInfo location, UUID fieldId, String type) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("fieldId", fieldId.toString());
    payload.put("parentId", location.parentId() == null ? null : location.parentId().toString());
    payload.put("path", location.path());
    events.record(location.workspaceId(), "location", location.id(), type, payload);
  }

  private TaskflowException stale(FieldInfo current) {
    return TaskflowException.conflict(
            "field.stale", "Someone else changed this field. Review and save again.")
        .with("current", view(current, null, false))
        .with("version", current.version());
  }

  private FieldInfo live(UUID fieldId) {
    return catalog
        .lookup(fieldId)
        .filter(f -> !f.retired())
        .orElseThrow(() -> TaskflowException.notFound("field.not_found", "Field not found"));
  }

  private String rankOf(UUID fieldId) {
    return jdbc.queryForObject("SELECT rank FROM custom_field WHERE id = ?", String.class, fieldId);
  }

  private FieldView view(FieldInfo f, UUID shownAt, boolean hidden) {
    return new FieldView(
        f.id(),
        f.name(),
        f.type(),
        f.config(),
        f.options(),
        f.definedAt(),
        f.definedAtName(),
        shownAt != null && !f.definedAt().equals(shownAt),
        hidden,
        f.version());
  }

  private boolean canEdit(UUID locationId) {
    try {
      permissions.require(Permissions.LOCATION, locationId, Action.EDIT);
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

  private String json(Object value) {
    try {
      return mapper.writeValueAsString(value);
    } catch (JsonProcessingException e) {
      throw new IllegalArgumentException("not serializable", e);
    }
  }
}
