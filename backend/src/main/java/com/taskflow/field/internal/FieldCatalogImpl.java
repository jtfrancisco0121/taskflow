package com.taskflow.field.internal;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.field.FieldCatalog;
import com.taskflow.field.FieldInfo;
import com.taskflow.field.FieldType;
import com.taskflow.field.OptionInfo;
import com.taskflow.field.ValidatedValues;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.LocationInfo;
import com.taskflow.workspace.LocationTree;
import com.taskflow.workspace.WorkspaceQuery;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** The one effective-set function (AD-4): every consumer calls it, none re-derives it. */
@Component
class FieldCatalogImpl implements FieldCatalog {

  /**
   * A live field defined at the location or an ancestor; {@code hiddenAt} is where it is hidden.
   */
  record Scoped(FieldInfo field, UUID hiddenAt) {}

  private static final TypeReference<Map<String, Object>> CONFIG = new TypeReference<>() {};

  private static final String SELECT =
      "SELECT f.id, f.workspace_id, f.location_id, l.name AS location_name, f.name, f.type,"
          + " f.config::text AS config, f.version, f.retired_at IS NOT NULL AS retired";

  private final JdbcTemplate jdbc;
  private final LocationTree tree;
  private final ObjectMapper mapper;
  private final WorkspaceQuery workspaces;

  FieldCatalogImpl(
      JdbcTemplate jdbc, LocationTree tree, ObjectMapper mapper, WorkspaceQuery workspaces) {
    this.workspaces = workspaces;
    this.jdbc = jdbc;
    this.tree = tree;
    this.mapper = mapper;
  }

  @Override
  public List<FieldInfo> effective(UUID locationId) {
    return tree.find(locationId)
        .map(location ->
            scoped(location).stream().filter(s -> s.hiddenAt() == null).map(Scoped::field).toList())
        .orElse(List.of());
  }

  @Override
  public Optional<FieldInfo> lookup(UUID fieldId) {
    List<FieldInfo> rows =
        jdbc.query(
            SELECT + " FROM custom_field f JOIN location l ON l.id = f.location_id WHERE f.id = ?",
            (rs, i) -> row(rs),
            fieldId);
    return attachOptions(rows).stream().findFirst();
  }

  @Override
  public ValidatedValues validate(UUID listId, Map<String, JsonNode> values) {
    if (values == null || values.isEmpty()) {
      return ValidatedValues.none();
    }
    List<FieldInfo> effective = effective(listId);
    Map<UUID, JsonNode> set = new LinkedHashMap<>();
    Set<UUID> cleared = new HashSet<>();
    Map<UUID, FieldInfo> used = new LinkedHashMap<>();
    for (Map.Entry<String, JsonNode> entry : values.entrySet()) {
      FieldInfo field = resolveKey(effective, entry.getKey());
      if (used.put(field.id(), field) != null) {
        throw TaskflowException.badRequest("field.invalid_value", field.name() + " is given twice")
            .with("fieldId", field.id().toString());
      }
      JsonNode value = FieldTypes.normalize(field, entry.getValue(), workspaces::membersAmong);
      if (value == null) {
        cleared.add(field.id());
      } else {
        set.put(field.id(), value);
      }
    }
    return new ValidatedValues(set, cleared, used);
  }

  @Override
  public Map<String, JsonNode> project(List<FieldInfo> effective, Map<String, JsonNode> stored) {
    Map<String, JsonNode> out = new LinkedHashMap<>();
    if (stored == null || stored.isEmpty()) {
      return out;
    }
    for (FieldInfo field : effective) {
      JsonNode value = FieldTypes.project(field, stored.get(field.id().toString()));
      if (value != null) {
        out.put(field.id().toString(), value);
      }
    }
    return out;
  }

  @Override
  public String display(FieldInfo field, JsonNode stored) {
    return FieldTypes.display(field, stored);
  }

  /** A key is a field id or, failing that, the name of an effective field (ignoring case). */
  private static FieldInfo resolveKey(List<FieldInfo> effective, String key) {
    String trimmed = key.trim();
    for (FieldInfo f : effective) {
      if (f.id().toString().equalsIgnoreCase(trimmed)) {
        return f;
      }
    }
    String lower = trimmed.toLowerCase(Locale.ROOT);
    for (FieldInfo f : effective) {
      if (f.name().toLowerCase(Locale.ROOT).equals(lower)) {
        return f;
      }
    }
    throw TaskflowException.badRequest(
            "field.not_available",
            "'" + key + "' is not a field of this List (or it is hidden here)")
        .with("field", key);
  }

  /** Every live field at the location or an ancestor, with the nearest hide, Space first. */
  List<Scoped> scoped(LocationInfo location) {
    String chain = chain(location.selfAndAncestorIds());
    Map<UUID, UUID> hidden = new HashMap<>();
    jdbc.query(
        "SELECT h.field_id, h.location_id FROM custom_field_hidden h WHERE h.location_id ="
            + " ANY (CAST(? AS uuid[])) ORDER BY array_position(CAST(? AS uuid[]), h.location_id)"
            + " DESC",
        rs -> {
          // Nearest hide wins: iterate far to near and overwrite.
          hidden.put(rs.getObject("field_id", UUID.class), rs.getObject("location_id", UUID.class));
        },
        chain,
        chain);
    List<FieldInfo> fields =
        attachOptions(
            jdbc.query(
                SELECT
                    + " FROM custom_field f JOIN location l ON l.id = f.location_id WHERE"
                    + " f.location_id = ANY (CAST(? AS uuid[])) AND f.retired_at IS NULL ORDER BY"
                    + " nlevel(l.path), f.rank COLLATE \"C\", f.id",
                (rs, i) -> row(rs),
                chain));
    List<Scoped> out = new ArrayList<>(fields.size());
    for (FieldInfo f : fields) {
      out.add(new Scoped(f, hidden.get(f.id())));
    }
    return out;
  }

  private FieldInfo row(java.sql.ResultSet rs) throws java.sql.SQLException {
    Map<String, Object> config;
    try {
      config = mapper.readValue(rs.getString("config"), CONFIG);
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      throw new IllegalStateException("custom_field.config is not JSON", e);
    }
    return new FieldInfo(
        rs.getObject("id", UUID.class),
        rs.getObject("workspace_id", UUID.class),
        rs.getObject("location_id", UUID.class),
        rs.getString("location_name"),
        rs.getString("name"),
        FieldType.valueOf(rs.getString("type")),
        config,
        List.of(),
        rs.getLong("version"),
        rs.getBoolean("retired"));
  }

  private List<FieldInfo> attachOptions(List<FieldInfo> fields) {
    List<FieldInfo> withOptions = fields.stream().filter(f -> f.type().hasOptions()).toList();
    if (withOptions.isEmpty()) {
      return fields;
    }
    String ids = chain(withOptions.stream().map(FieldInfo::id).toList());
    Map<UUID, List<OptionInfo>> byField = new HashMap<>();
    jdbc.query(
        "SELECT id, field_id, name, color FROM custom_field_option WHERE field_id = ANY (CAST(? AS"
            + " uuid[])) AND retired_at IS NULL ORDER BY field_id, rank COLLATE \"C\", id",
        rs -> {
          byField
              .computeIfAbsent(rs.getObject("field_id", UUID.class), k -> new ArrayList<>())
              .add(
                  new OptionInfo(
                      rs.getObject("id", UUID.class), rs.getString("name"), rs.getString("color")));
        },
        ids);
    return fields.stream()
        .map(f ->
            !f.type().hasOptions()
                ? f
                : new FieldInfo(
                    f.id(),
                    f.workspaceId(),
                    f.definedAt(),
                    f.definedAtName(),
                    f.name(),
                    f.type(),
                    f.config(),
                    byField.getOrDefault(f.id(), List.of()),
                    f.version(),
                    f.retired()))
        .toList();
  }

  static String chain(List<UUID> ids) {
    return ids.stream().map(UUID::toString).collect(Collectors.joining(",", "{", "}"));
  }
}
