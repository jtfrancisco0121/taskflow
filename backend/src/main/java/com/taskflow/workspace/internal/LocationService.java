package com.taskflow.workspace.internal;

import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.Ids;
import com.taskflow.shared.Page;
import com.taskflow.shared.RankAllocator;
import com.taskflow.shared.RankScopeLock;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.Action;
import com.taskflow.workspace.LocationAccess;
import com.taskflow.workspace.LocationCreated;
import com.taskflow.workspace.LocationMoved;
import com.taskflow.workspace.LocationType;
import com.taskflow.workspace.Permissions;
import com.taskflow.workspace.Role;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Spaces, Folders and Lists (LOC-1, LOC-2, LOC-4). Every structural write first takes the workspace
 * advisory lock and re-reads the rows it depends on inside it (decision 002 item 6).
 */
@Service
class LocationService {

  record LocationView(
      UUID id,
      UUID workspaceId,
      UUID parentId,
      LocationType type,
      String name,
      boolean isPrivate,
      boolean archived,
      Instant createdAt,
      List<LocationView> children) {

    LocationView withChildren(List<LocationView> children) {
      return new LocationView(
          id, workspaceId, parentId, type, name, isPrivate, archived, createdAt, children);
    }
  }

  record TreeNode(
      UUID id,
      UUID parentId,
      LocationType type,
      String name,
      boolean isPrivate,
      boolean archived,
      boolean hasChildren) {}

  private record Row(
      UUID id,
      UUID workspaceId,
      UUID parentId,
      LocationType type,
      String name,
      String path,
      boolean isPrivate,
      boolean archived,
      boolean deleted,
      Instant createdAt) {}

  private static final String COLUMNS =
      "id, workspace_id, parent_id, type, name, path::text AS path, is_private, archived_at IS NOT"
          + " NULL AS archived, deleted_at IS NOT NULL AS deleted, created_at";

  private static final RowMapper<Row> ROW =
      (rs, i) ->
          new Row(
              rs.getObject("id", UUID.class),
              rs.getObject("workspace_id", UUID.class),
              rs.getObject("parent_id", UUID.class),
              LocationType.valueOf(rs.getString("type")),
              rs.getString("name"),
              rs.getString("path"),
              rs.getBoolean("is_private"),
              rs.getBoolean("archived"),
              rs.getBoolean("deleted"),
              rs.getTimestamp("created_at").toInstant());

  private final JdbcTemplate jdbc;
  private final NamedParameterJdbcTemplate named;
  private final EventRecorder events;
  private final Permissions permissions;
  private final MembershipLookup memberships;
  private final WorkspaceLock lock;
  private final RankScopeLock rankLock;
  private final RankAllocator ranks;
  private final ApplicationEventPublisher publisher;

  LocationService(
      JdbcTemplate jdbc,
      NamedParameterJdbcTemplate named,
      EventRecorder events,
      Permissions permissions,
      MembershipLookup memberships,
      WorkspaceLock lock,
      RankScopeLock rankLock,
      RankAllocator ranks,
      ApplicationEventPublisher publisher) {
    this.jdbc = jdbc;
    this.named = named;
    this.events = events;
    this.permissions = permissions;
    this.memberships = memberships;
    this.lock = lock;
    this.rankLock = rankLock;
    this.ranks = ranks;
    this.publisher = publisher;
  }

  @Transactional
  LocationView create(
      LocationType type, UUID workspaceId, UUID parentId, String name, boolean isPrivate) {
    String cleanName = name.trim();
    UUID workspace;
    if (type == LocationType.SPACE) {
      if (workspaceId == null) {
        throw TaskflowException.badRequest(
            "location.workspace_required", "A Space needs a workspaceId");
      }
      permissions.require(Permissions.WORKSPACE, workspaceId, Action.MANAGE);
      workspace = workspaceId;
      lock.lock(workspace);
      return insert(workspace, null, null, type, cleanName, isPrivate, true);
    }
    if (parentId == null) {
      throw TaskflowException.badRequest(
          "location.parent_required", "A Folder or List needs a parentId");
    }
    permissions.require(Permissions.LOCATION, parentId, Action.CREATE);
    Row parent = requireLive(parentId, null);
    lock.lock(parent.workspaceId());
    parent = requireLive(parentId, parent.workspaceId());
    checkNesting(type, parent.type());
    LocationView created =
        insert(parent.workspaceId(), parent.id(), parent.path(), type, cleanName, isPrivate, true);
    if (type == LocationType.FOLDER) {
      Row folder = requireLive(created.id(), parent.workspaceId());
      LocationView list =
          insert(
              folder.workspaceId(),
              folder.id(),
              folder.path(),
              LocationType.LIST,
              "List",
              false,
              true);
      return created.withChildren(List.of(list));
    }
    return created;
  }

  @Transactional(readOnly = true)
  LocationView get(UUID id) {
    Row row = find(id);
    return view(row);
  }

  @Transactional
  LocationView update(UUID id, String name, Boolean isPrivate) {
    Row before = requireLive(id, null);
    lock.lock(before.workspaceId());
    Row row = requireLive(id, before.workspaceId());
    if (name != null && !name.trim().equals(row.name())) {
      jdbc.update("UPDATE location SET name = ? WHERE id = ?", name.trim(), id);
      events.record(
          row.workspaceId(),
          "location",
          id,
          "location.renamed",
          payload(row, "name", Map.of("from", row.name(), "to", name.trim())));
    }
    if (isPrivate != null && isPrivate != row.isPrivate()) {
      jdbc.update("UPDATE location SET is_private = ? WHERE id = ?", isPrivate, id);
      onPrivacyChanged(row, isPrivate);
      events.record(
          row.workspaceId(),
          "location",
          id,
          "location.privacy_changed",
          payload(row, "isPrivate", Map.of("from", row.isPrivate(), "to", isPrivate)));
    }
    return view(requireLive(id, row.workspaceId()));
  }

  /** A member who makes a location private keeps access to it: they are granted it. */
  private void onPrivacyChanged(Row row, boolean nowPrivate) {
    if (nowPrivate) {
      grantToCreator(row.workspaceId(), row.id());
    }
  }

  @Transactional
  LocationView move(UUID id, UUID newParentId, UUID beforeId, UUID afterId) {
    Row seen = requireLive(id, null);
    lock.lock(seen.workspaceId());
    Row moving = requireLive(id, seen.workspaceId());
    UUID targetParentId = newParentId != null ? newParentId : moving.parentId();
    boolean reparent = !java.util.Objects.equals(targetParentId, moving.parentId());
    if (moving.type() == LocationType.SPACE && newParentId != null) {
      throw TaskflowException.badRequest("location.invalid_parent", "A Space has no parent");
    }
    Row target = null;
    if (targetParentId != null) {
      if (reparent) {
        permissions.require(Permissions.LOCATION, targetParentId, Action.CREATE);
      }
      target = requireLive(targetParentId, null);
      if (!target.workspaceId().equals(moving.workspaceId())) {
        throw TaskflowException.badRequest(
            "location.invalid_parent", "The new parent is in another workspace");
      }
      checkNesting(moving.type(), target.type());
      if (isInSubtree(target.path(), moving.path())) {
        throw TaskflowException.conflict(
            "location.move_into_own_subtree", "A location cannot move into its own subtree");
      }
    }
    for (UUID neighbour : new UUID[] {beforeId, afterId}) {
      if (neighbour != null) {
        permissions.require(Permissions.LOCATION, neighbour, Action.VIEW);
      }
    }
    UUID scopeOwner = targetParentId != null ? targetParentId : moving.workspaceId();
    rankLock.lock(
        targetParentId != null ? RankScopeLock.Owner.LOCATION : RankScopeLock.Owner.WORKSPACE,
        scopeOwner);
    String rank = ranks.place(scope(moving.workspaceId(), targetParentId), id, beforeId, afterId);
    if (!reparent) {
      jdbc.update("UPDATE location SET rank = ? WHERE id = ?", rank, id);
      events.record(moving.workspaceId(), "location", id, "location.reordered", payload(moving));
      return view(requireLive(id, moving.workspaceId()));
    }
    String newPath = target.path() + "." + Ids.label(id);
    jdbc.update(
        "UPDATE location SET parent_id = ?, rank = ? WHERE id = ?", targetParentId, rank, id);
    jdbc.update("UPDATE location SET path = CAST(? AS ltree) WHERE id = ?", newPath, id);
    jdbc.update(
        "UPDATE location SET path = CAST(? AS ltree) || subpath(path, nlevel(CAST(? AS ltree)))"
            + " WHERE workspace_id = ? AND path <@ CAST(? AS ltree) AND id <> ?",
        newPath,
        moving.path(),
        moving.workspaceId(),
        moving.path(),
        id);
    List<UUID> lists =
        jdbc.queryForList(
            "SELECT id FROM location WHERE workspace_id = ? AND path <@ CAST(? AS ltree) AND type ="
                + " 'LIST' AND deleted_at IS NULL",
            UUID.class,
            moving.workspaceId(),
            newPath);
    // parentId and path are the new place (AD-12); the old one rides along for subscribers of it
    Map<String, Object> payload = payload(moving.workspaceId(), id, targetParentId, newPath);
    payload.put("fromParentId", moving.parentId() == null ? null : moving.parentId().toString());
    payload.put("fromPath", moving.path());
    events.record(moving.workspaceId(), "location", id, "location.moved", payload);
    publisher.publishEvent(
        new LocationMoved(id, moving.workspaceId(), moving.parentId(), targetParentId, lists));
    return view(requireLive(id, moving.workspaceId()));
  }

  @Transactional
  LocationView archive(UUID id) {
    Row before = requireLive(id, null);
    lock.lock(before.workspaceId());
    Row row = requireLive(id, before.workspaceId());
    jdbc.update(
        "UPDATE location SET archived_at = now() WHERE workspace_id = ? AND path <@ CAST(? AS ltree)"
            + " AND archived_at IS NULL AND deleted_at IS NULL",
        row.workspaceId(),
        row.path());
    events.record(row.workspaceId(), "location", id, "location.archived", payload(row));
    return view(requireLive(id, row.workspaceId()));
  }

  @Transactional
  LocationView unarchive(UUID id) {
    Row before = requireLive(id, null);
    lock.lock(before.workspaceId());
    Row row = requireLive(id, before.workspaceId());
    jdbc.update(
        "UPDATE location SET archived_at = NULL WHERE workspace_id = ? AND path <@ CAST(? AS ltree)"
            + " AND archived_at IS NOT NULL AND deleted_at IS NULL",
        row.workspaceId(),
        row.path());
    events.record(row.workspaceId(), "location", id, "location.unarchived", payload(row));
    return view(requireLive(id, row.workspaceId()));
  }

  @Transactional
  void delete(UUID id) {
    Row before = requireLive(id, null);
    lock.lock(before.workspaceId());
    Row row = requireLive(id, before.workspaceId());
    jdbc.update(
        "UPDATE location SET deleted_at = now() WHERE workspace_id = ? AND path <@ CAST(? AS ltree)"
            + " AND deleted_at IS NULL",
        row.workspaceId(),
        row.path());
    events.record(row.workspaceId(), "location", id, "location.deleted", payload(row));
  }

  /** Direct visible children of a parent (or the Spaces), each with hasChildren (LOC-4). */
  @Transactional(readOnly = true)
  Page<TreeNode> tree(UUID workspaceId, UUID parentId, boolean includeArchived) {
    Role role = memberships.role(workspaceId, CurrentActor.userId()).orElseThrow();
    if (parentId != null) {
      permissions.require(Permissions.LOCATION, parentId, Action.VIEW);
      Row parent = find(parentId);
      if (!parent.workspaceId().equals(workspaceId)) {
        throw TaskflowException.notFound("location.not_found", "Location not found");
      }
    }
    MapSqlParameterSource params =
        new MapSqlParameterSource(LocationAccess.params(CurrentActor.userId(), role));
    params.addValue("w", workspaceId);
    params.addValue("p", parentId, java.sql.Types.OTHER);
    params.addValue("inc", includeArchived);
    List<TreeNode> nodes =
        named.query(
            "SELECT l.id, l.parent_id, l.type, l.name, l.is_private, l.archived_at IS NOT NULL AS"
                + " archived, EXISTS (SELECT 1 FROM location c WHERE c.workspace_id = l.workspace_id"
                + " AND c.parent_id = l.id AND (:inc OR c.archived_at IS NULL) AND "
                + LocationAccess.visible("c")
                + ") AS has_children FROM location l WHERE l.workspace_id = :w AND l.parent_id IS NOT"
                + " DISTINCT FROM CAST(:p AS uuid) AND"
                + " (:inc OR l.archived_at IS NULL) AND "
                + LocationAccess.visible("l")
                + " ORDER BY l.rank COLLATE \"C\", l.id",
            params,
            (rs, i) ->
                new TreeNode(
                    rs.getObject("id", UUID.class),
                    rs.getObject("parent_id", UUID.class),
                    LocationType.valueOf(rs.getString("type")),
                    rs.getString("name"),
                    rs.getBoolean("is_private"),
                    rs.getBoolean("archived"),
                    rs.getBoolean("has_children")));
    return new Page<>(nodes, null);
  }

  private LocationView insert(
      UUID workspaceId,
      UUID parentId,
      String parentPath,
      LocationType type,
      String name,
      boolean isPrivate,
      boolean announce) {
    rankLock.lock(
        parentId != null ? RankScopeLock.Owner.LOCATION : RankScopeLock.Owner.WORKSPACE,
        parentId != null ? parentId : workspaceId);
    String rank = ranks.append(scope(workspaceId, parentId));
    UUID id = Ids.newId();
    String path = parentPath == null ? Ids.label(id) : parentPath + "." + Ids.label(id);
    jdbc.update(
        "INSERT INTO location (id, workspace_id, parent_id, type, name, path, is_private, rank)"
            + " VALUES (?, ?, ?, ?, ?, CAST(? AS ltree), ?, ?)",
        id,
        workspaceId,
        parentId,
        type.name(),
        name,
        path,
        isPrivate,
        rank);
    onCreated(workspaceId, id, isPrivate);
    events.record(
        workspaceId,
        "location",
        id,
        "location.created",
        withExtra(payload(workspaceId, id, parentId, path), "type", type.name(), "name", name));
    if (announce) {
      publisher.publishEvent(new LocationCreated(id, workspaceId, type, parentId));
    }
    return view(requireLive(id, workspaceId));
  }

  /** Every location event carries parentId and path so routing never reads rows (AD-12). */
  private static Map<String, Object> payload(Row row, Object... extra) {
    return withExtra(payload(row.workspaceId(), row.id(), row.parentId(), row.path()), extra);
  }

  private static Map<String, Object> payload(
      UUID workspaceId, UUID id, UUID parentId, String path) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("parentId", parentId == null ? null : parentId.toString());
    m.put("path", path);
    return m;
  }

  private static Map<String, Object> withExtra(Map<String, Object> m, Object... extra) {
    for (int i = 0; i + 1 < extra.length; i += 2) {
      m.put((String) extra[i], extra[i + 1]);
    }
    return m;
  }

  /** The creator keeps access to a private location they make. */
  private void onCreated(UUID workspaceId, UUID id, boolean isPrivate) {
    if (isPrivate) {
      grantToCreator(workspaceId, id);
    }
  }

  private void grantToCreator(UUID workspaceId, UUID locationId) {
    UUID me = CurrentActor.userId();
    Role role = memberships.role(workspaceId, me).orElseThrow();
    if (!role.isAdminOrOwner()) {
      jdbc.update(
          "INSERT INTO location_grant (workspace_id, location_id, user_id, granted_by) VALUES (?, ?,"
              + " ?, ?) ON CONFLICT DO NOTHING",
          workspaceId,
          locationId,
          me,
          me);
    }
  }

  private static RankAllocator.Scope scope(UUID workspaceId, UUID parentId) {
    return parentId == null
        ? new RankAllocator.Scope(
            "location",
            "workspace_id = ? AND parent_id IS NULL AND deleted_at IS NULL",
            workspaceId)
        : new RankAllocator.Scope(
            "location",
            "workspace_id = ? AND parent_id = ? AND deleted_at IS NULL",
            workspaceId,
            parentId);
  }

  private static void checkNesting(LocationType child, LocationType parent) {
    boolean ok =
        switch (child) {
          case SPACE -> false;
          case FOLDER -> parent == LocationType.SPACE;
          case LIST -> parent == LocationType.SPACE || parent == LocationType.FOLDER;
        };
    if (!ok) {
      throw TaskflowException.badRequest(
          "location.invalid_parent", "A " + child + " cannot live inside a " + parent);
    }
  }

  /** True when {@code path} is {@code root} or below it. */
  private static boolean isInSubtree(String path, String root) {
    return path.equals(root) || path.startsWith(root + ".");
  }

  private Row find(UUID id) {
    return jdbc.query("SELECT " + COLUMNS + " FROM location WHERE id = ?", ROW, id).stream()
        .findFirst()
        .orElseThrow(() -> TaskflowException.notFound("location.not_found", "Location not found"));
  }

  /** A live location, optionally required to be in a workspace. */
  private Row requireLive(UUID id, UUID workspaceId) {
    Row row = find(id);
    if (row.deleted() || (workspaceId != null && !row.workspaceId().equals(workspaceId))) {
      throw TaskflowException.notFound("location.not_found", "Location not found");
    }
    return row;
  }

  private static LocationView view(Row row) {
    return new LocationView(
        row.id(),
        row.workspaceId(),
        row.parentId(),
        row.type(),
        row.name(),
        row.isPrivate(),
        row.archived(),
        row.createdAt(),
        null);
  }

  /** Used by tests of the lock order: lists the ids of a subtree. */
  List<UUID> subtreeIds(UUID id) {
    Row row = find(id);
    return new ArrayList<>(
        jdbc.queryForList(
            "SELECT id FROM location WHERE workspace_id = ? AND path <@ CAST(? AS ltree)",
            UUID.class,
            row.workspaceId(),
            row.path()));
  }
}
