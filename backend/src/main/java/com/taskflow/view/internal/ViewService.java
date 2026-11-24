package com.taskflow.view.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.Ids;
import com.taskflow.shared.RankAllocator;
import com.taskflow.shared.TaskflowException;
import com.taskflow.view.ViewConfig;
import com.taskflow.workspace.Action;
import com.taskflow.workspace.LocationInfo;
import com.taskflow.workspace.LocationTree;
import com.taskflow.workspace.Permissions;
import com.taskflow.workspace.Role;
import com.taskflow.workspace.WorkspaceQuery;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Saved views, their visibility and the virtual default views (VIEW-1, VIEW-2, AD-8). */
@Service
class ViewService {

  static final Set<String> TYPES = Set.of("LIST", "BOARD", "TABLE", "CALENDAR");
  static final Set<String> VISIBILITIES = Set.of("SHARED", "PERSONAL", "PRIVATE");
  static final Set<String> DEFAULT_KINDS = Set.of("LIST", "BOARD");

  /** A view as the API returns it; a virtual default has a null {@code id} and owner. */
  record ViewDto(
      UUID id,
      UUID workspaceId,
      UUID locationId,
      UUID ownerId,
      String name,
      String type,
      String visibility,
      String defaultKind,
      ViewConfig config,
      List<UUID> shareWith) {}

  record ViewList(List<ViewDto> items) {}

  record CreateInput(
      UUID workspaceId,
      UUID locationId,
      String name,
      String type,
      String visibility,
      String defaultKind,
      ViewConfig config,
      List<UUID> shareWith) {}

  record UpdateInput(String name, String visibility, ViewConfig config, List<UUID> shareWith) {}

  private record Row(
      UUID id,
      UUID workspaceId,
      UUID locationId,
      UUID ownerId,
      String name,
      String type,
      String visibility,
      String defaultKind,
      String config) {}

  private static final String SELECT =
      "SELECT v.id, v.workspace_id, v.location_id, v.owner_id, v.name, v.type, v.visibility,"
          + " v.default_kind, v.config::text AS config FROM view v";
  private static final String VISIBLE =
      "(v.visibility = 'SHARED' OR v.owner_id = ? OR (v.visibility = 'PRIVATE' AND EXISTS (SELECT"
          + " 1 FROM view_share s WHERE s.view_id = v.id AND s.user_id = ?)))";

  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;
  private final Permissions permissions;
  private final WorkspaceQuery workspaces;
  private final LocationTree tree;
  private final RankAllocator ranks;
  private final CustomFieldRefs customFields;

  ViewService(
      JdbcTemplate jdbc,
      ObjectMapper mapper,
      Permissions permissions,
      WorkspaceQuery workspaces,
      LocationTree tree,
      RankAllocator ranks,
      CustomFieldRefs customFields) {
    this.jdbc = jdbc;
    this.mapper = mapper;
    this.permissions = permissions;
    this.workspaces = workspaces;
    this.tree = tree;
    this.ranks = ranks;
    this.customFields = customFields;
  }

  @Transactional(readOnly = true)
  ViewList forLocation(UUID locationId) {
    permissions.require(Permissions.LOCATION, locationId, Action.VIEW);
    LocationInfo location =
        tree.find(locationId)
            .filter(l -> !l.deleted())
            .orElseThrow(
                () -> TaskflowException.notFound("location.not_found", "Location not found"));
    if (location.archived()) {
      return new ViewList(List.of());
    }
    return new ViewList(list(location.workspaceId(), locationId));
  }

  @Transactional(readOnly = true)
  ViewList forWorkspace(UUID workspaceId) {
    permissions.require(Permissions.WORKSPACE, workspaceId, Action.VIEW);
    return new ViewList(list(workspaceId, null));
  }

  private List<ViewDto> list(UUID workspaceId, UUID locationId) {
    UUID me = CurrentActor.userId();
    List<Row> rows =
        jdbc.query(
            SELECT
                + " WHERE v.workspace_id = ? AND v.location_id IS NOT DISTINCT FROM ? AND "
                + VISIBLE
                + " ORDER BY v.rank, v.id",
            (rs, i) ->
                new Row(
                    rs.getObject("id", UUID.class),
                    rs.getObject("workspace_id", UUID.class),
                    rs.getObject("location_id", UUID.class),
                    rs.getObject("owner_id", UUID.class),
                    rs.getString("name"),
                    rs.getString("type"),
                    rs.getString("visibility"),
                    rs.getString("default_kind"),
                    rs.getString("config")),
            workspaceId,
            locationId,
            me,
            me);
    List<ViewDto> out = new ArrayList<>();
    for (String kind : List.of("LIST", "BOARD")) {
      Optional<Row> stored = rows.stream().filter(r -> kind.equals(r.defaultKind())).findFirst();
      out.add(
          stored
              .map(r -> dto(r, shares(r.id())))
              .orElseGet(() -> virtual(workspaceId, locationId, kind)));
    }
    for (Row r : rows) {
      if (r.defaultKind() == null) {
        out.add(dto(r, shares(r.id())));
      }
    }
    return out;
  }

  private ViewDto virtual(UUID workspaceId, UUID locationId, String kind) {
    return new ViewDto(
        null,
        workspaceId,
        locationId,
        null,
        kind.equals("LIST") ? "List" : "Board",
        kind,
        "SHARED",
        kind,
        new ViewConfig(
            1, null, "status", List.of(new ViewConfig.Sort("manual", "asc")), null, null),
        List.of());
  }

  @Transactional
  ViewDto create(CreateInput in) {
    if ((in.workspaceId() == null) == (in.locationId() == null)) {
      throw TaskflowException.badRequest(
          "view.scope_required", "Pass exactly one of workspaceId and locationId");
    }
    UUID workspaceId;
    if (in.locationId() != null) {
      permissions.require(Permissions.LOCATION, in.locationId(), Action.CREATE);
      workspaceId =
          tree.find(in.locationId())
              .orElseThrow(
                  () -> TaskflowException.notFound("location.not_found", "Location not found"))
              .workspaceId();
    } else {
      workspaceId = in.workspaceId();
      permissions.require(Permissions.WORKSPACE, workspaceId, Action.VIEW);
      Role role = workspaces.roleOf(workspaceId, CurrentActor.userId()).orElseThrow();
      if (!role.canWork()) {
        throw TaskflowException.forbidden("auth.forbidden", "Your role may not do this");
      }
    }
    String type = in.type();
    if (type == null || !TYPES.contains(type)) {
      throw TaskflowException.badRequest(
          "view.invalid_type", "Type is LIST, BOARD, TABLE or CALENDAR");
    }
    String kind = in.defaultKind();
    String visibility = in.visibility() == null ? "SHARED" : in.visibility();
    if (kind != null) {
      if (!DEFAULT_KINDS.contains(kind) || !kind.equals(type)) {
        throw TaskflowException.badRequest(
            "view.invalid_default", "A default view is a LIST or a BOARD of the same type");
      }
      visibility = "SHARED";
    }
    if (!VISIBILITIES.contains(visibility)) {
      throw TaskflowException.badRequest(
          "view.invalid_visibility", "Visibility is SHARED, PERSONAL or PRIVATE");
    }
    String name =
        cleanName(
            in.name() == null && kind != null ? kind.equals("LIST") ? "List" : "Board" : in.name());
    ViewConfigValidator.validate(in.config());
    customFields.checkForSave(
        in.config(),
        in.locationId() == null ? null : tree.find(in.locationId()).orElse(null),
        workspaceId);
    List<UUID> shares = checkShares(workspaceId, visibility, in.shareWith());
    UUID id = Ids.newId();
    String rank =
        ranks.append(
            new RankAllocator.Scope(
                "view",
                "workspace_id = ? AND location_id IS NOT DISTINCT FROM ? AND default_kind IS NULL",
                workspaceId,
                in.locationId()));
    try {
      jdbc.update(
          "INSERT INTO view (id, workspace_id, location_id, owner_id, name, type, visibility,"
              + " default_kind, config, rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?)",
          id,
          workspaceId,
          in.locationId(),
          CurrentActor.userId(),
          name,
          type,
          visibility,
          kind,
          json(in.config()),
          rank);
    } catch (DuplicateKeyException e) {
      throw TaskflowException.conflict(
          "view.default_exists", "This scope already stores a default " + kind + " view");
    }
    replaceShares(workspaceId, id, shares);
    return dto(load(id), shares);
  }

  @Transactional(readOnly = true)
  ViewDto get(UUID id) {
    Row row = loadVisible(id);
    return dto(row, shares(id));
  }

  @Transactional
  ViewDto update(UUID id, UpdateInput in) {
    Row row = loadVisible(id);
    requireOwnerOrAdmin(row);
    String name = in.name() == null ? row.name() : cleanName(in.name());
    String visibility = in.visibility() == null ? row.visibility() : in.visibility();
    if (!VISIBILITIES.contains(visibility)) {
      throw TaskflowException.badRequest(
          "view.invalid_visibility", "Visibility is SHARED, PERSONAL or PRIVATE");
    }
    if (row.defaultKind() != null && !visibility.equals("SHARED")) {
      throw TaskflowException.badRequest("view.invalid_visibility", "A default view stays shared");
    }
    ViewConfig config = in.config();
    if (config != null) {
      ViewConfigValidator.validate(config);
      customFields.checkForSave(
          config,
          row.locationId() == null ? null : tree.find(row.locationId()).orElse(null),
          row.workspaceId());
    }
    List<UUID> shares =
        in.shareWith() == null
            ? shares(id)
            : checkShares(row.workspaceId(), visibility, in.shareWith());
    if (!visibility.equals("PRIVATE")) {
      shares = List.of();
    }
    jdbc.update(
        "UPDATE view SET name = ?, visibility = ?, config = CAST(? AS jsonb), updated_at = now()"
            + " WHERE id = ?",
        name,
        visibility,
        config == null ? row.config() : json(config),
        id);
    replaceShares(row.workspaceId(), id, shares);
    return dto(load(id), shares);
  }

  @Transactional
  void delete(UUID id) {
    Row row = loadVisible(id);
    requireOwnerOrAdmin(row);
    jdbc.update("DELETE FROM view WHERE id = ?", id);
  }

  // ---- helpers ----

  private Row load(UUID id) {
    return jdbc
        .query(
            SELECT + " WHERE v.id = ?",
            (rs, i) ->
                new Row(
                    rs.getObject("id", UUID.class),
                    rs.getObject("workspace_id", UUID.class),
                    rs.getObject("location_id", UUID.class),
                    rs.getObject("owner_id", UUID.class),
                    rs.getString("name"),
                    rs.getString("type"),
                    rs.getString("visibility"),
                    rs.getString("default_kind"),
                    rs.getString("config")),
            id)
        .stream()
        .findFirst()
        .orElseThrow(() -> TaskflowException.notFound("view.not_found", "View not found"));
  }

  /** The view when the caller can see its scope and the view itself; 404 otherwise. */
  private Row loadVisible(UUID id) {
    Row row = load(id);
    try {
      if (row.locationId() != null) {
        permissions.require(Permissions.LOCATION, row.locationId(), Action.VIEW);
      } else {
        permissions.require(Permissions.WORKSPACE, row.workspaceId(), Action.VIEW);
      }
    } catch (TaskflowException e) {
      if (e.status().value() == 404) {
        throw TaskflowException.notFound("view.not_found", "View not found");
      }
      throw e;
    }
    UUID me = CurrentActor.userId();
    boolean visible =
        Boolean.TRUE.equals(
            jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM view v WHERE v.id = ? AND " + VISIBLE + ")",
                Boolean.class,
                id,
                me,
                me));
    if (!visible && !isAdmin(row.workspaceId())) {
      throw TaskflowException.notFound("view.not_found", "View not found");
    }
    return row;
  }

  private boolean isAdmin(UUID workspaceId) {
    return workspaces
        .roleOf(workspaceId, CurrentActor.userId())
        .map(Role::isAdminOrOwner)
        .orElse(false);
  }

  private void requireOwnerOrAdmin(Row row) {
    if (!row.ownerId().equals(CurrentActor.userId()) && !isAdmin(row.workspaceId())) {
      throw TaskflowException.forbidden(
          "auth.forbidden", "Only the owner or a workspace admin may change this view");
    }
  }

  private static String cleanName(String name) {
    if (name == null || name.isBlank() || name.trim().length() > 100) {
      throw TaskflowException.badRequest(
          "view.invalid_name", "A view name has 1 to 100 characters");
    }
    return name.trim();
  }

  private List<UUID> checkShares(UUID workspaceId, String visibility, List<UUID> shareWith) {
    if (!visibility.equals("PRIVATE") || shareWith == null || shareWith.isEmpty()) {
      return List.of();
    }
    List<UUID> distinct = new ArrayList<>(new LinkedHashSet<>(shareWith));
    distinct.remove(CurrentActor.userId());
    if (workspaces.membersAmong(workspaceId, distinct).size() != distinct.size()) {
      throw TaskflowException.badRequest(
          "view.invalid_share", "A view can be shared only with workspace members");
    }
    return distinct;
  }

  private void replaceShares(UUID workspaceId, UUID viewId, List<UUID> users) {
    jdbc.update("DELETE FROM view_share WHERE view_id = ?", viewId);
    for (UUID user : users) {
      jdbc.update(
          "INSERT INTO view_share (view_id, user_id, workspace_id) VALUES (?, ?, ?)",
          viewId,
          user,
          workspaceId);
    }
  }

  private List<UUID> shares(UUID viewId) {
    if (viewId == null) {
      return List.of();
    }
    return jdbc.queryForList(
        "SELECT user_id FROM view_share WHERE view_id = ? ORDER BY user_id", UUID.class, viewId);
  }

  private ViewDto dto(Row r, List<UUID> shares) {
    try {
      return new ViewDto(
          r.id(),
          r.workspaceId(),
          r.locationId(),
          r.ownerId(),
          r.name(),
          r.type(),
          r.visibility(),
          r.defaultKind(),
          mapper.readValue(r.config(), ViewConfig.class),
          shares);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("stored view config is unreadable", e);
    }
  }

  private String json(ViewConfig config) {
    try {
      return mapper.writeValueAsString(config);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
  }
}
