package com.taskflow.view.internal;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.field.CustomFieldSql;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.PageCursor;
import com.taskflow.shared.TaskflowException;
import com.taskflow.task.TaskReader;
import com.taskflow.task.TaskView;
import com.taskflow.view.ViewConfig;
import com.taskflow.workspace.Action;
import com.taskflow.workspace.LocationInfo;
import com.taskflow.workspace.LocationTree;
import com.taskflow.workspace.Permissions;
import com.taskflow.workspace.Role;
import com.taskflow.workspace.WorkspaceQuery;
import java.time.Clock;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Runs a view config against a scope: the one task read of every renderer (AD-5). */
@Service
class ViewQueryService {

  record QueryScope(UUID locationId, UUID workspaceId) {}

  record QueryRequest(
      QueryScope scope, ViewConfig config, String groupValue, String cursor, Integer limit) {}

  /** A task with the group it was listed under (null when the config has no grouping). */
  record ViewItem(String group, TaskView task) {}

  record GroupInfo(String key, String label, long count) {}

  /** A {@code cf:<id>} reference the query dropped because the field is not live here. */
  record DroppedField(String ref, String name) {}

  record QueryResponse(
      List<ViewItem> items,
      String nextCursor,
      List<GroupInfo> groups,
      List<DroppedField> droppedFields) {}

  private final DSLContext dsl;
  private final ViewQueryCompiler compiler;
  private final TaskReader tasks;
  private final Permissions permissions;
  private final LocationTree tree;
  private final WorkspaceQuery workspaces;
  private final CustomFieldRefs customFields;

  ViewQueryService(
      DSLContext dsl,
      TaskReader tasks,
      Permissions permissions,
      LocationTree tree,
      WorkspaceQuery workspaces,
      CustomFieldRefs customFields,
      CustomFieldSql customSql,
      ObjectMapper mapper) {
    this.dsl = dsl;
    this.compiler = new ViewQueryCompiler(Clock.systemUTC(), mapper, customSql);
    this.customFields = customFields;
    this.tasks = tasks;
    this.permissions = permissions;
    this.tree = tree;
    this.workspaces = workspaces;
  }

  @Transactional(readOnly = true)
  QueryResponse query(QueryRequest request) {
    ViewConfigValidator.validate(request.config());
    QueryScope s = request.scope();
    if (s == null || (s.locationId() == null) == (s.workspaceId() == null)) {
      throw TaskflowException.badRequest(
          "view.scope_required", "Pass exactly one of scope.locationId and scope.workspaceId");
    }
    UUID workspaceId;
    String path = null;
    LocationInfo scopeLocation = null;
    if (s.locationId() != null) {
      permissions.require(Permissions.LOCATION, s.locationId(), Action.VIEW);
      LocationInfo location =
          tree.find(s.locationId())
              .orElseThrow(
                  () -> TaskflowException.notFound("location.not_found", "Location not found"));
      workspaceId = location.workspaceId();
      path = location.path();
      scopeLocation = location;
    } else {
      permissions.require(Permissions.WORKSPACE, s.workspaceId(), Action.VIEW);
      workspaceId = s.workspaceId();
    }
    UUID userId = CurrentActor.userId();
    Role role =
        workspaces
            .roleOf(workspaceId, userId)
            .orElseThrow(
                () -> TaskflowException.notFound("workspace.not_found", "Workspace not found"));
    int limit = PageCursor.limit(request.limit());
    // AD-8: references to fields that are not live are dropped and named, never an error.
    CustomFieldRefs.Prepared prepared =
        customFields.prepare(request.config(), scopeLocation, workspaceId);
    ViewQueryCompiler.Request r =
        new ViewQueryCompiler.Request(
            new ViewQueryCompiler.Scope(workspaceId, path, userId, role),
            prepared.config(),
            request.groupValue(),
            request.cursor(),
            limit,
            prepared.bound());
    ViewQueryCompiler.Compiled compiled = compiler.compile(dsl, r);
    List<Record> rows = compiled.select().fetch();
    boolean more = rows.size() > limit;
    List<Record> page = more ? rows.subList(0, limit) : rows;
    String next = more ? compiler.cursorFor(r, compiled, page.get(page.size() - 1)) : null;

    List<UUID> ids =
        new ArrayList<>(new LinkedHashSet<>(page.stream().map(x -> x.get(0, UUID.class)).toList()));
    Map<UUID, TaskView> byId = new HashMap<>();
    for (TaskView v : tasks.views(ids)) {
      byId.put(v.id(), v);
    }
    List<ViewItem> items = new ArrayList<>();
    for (Record row : page) {
      TaskView task = byId.get(row.get(0, UUID.class));
      if (task != null) {
        items.add(
            new ViewItem(compiled.groupKey() == null ? null : row.get("gk", String.class), task));
      }
    }
    List<GroupInfo> groups = null;
    if (request.cursor() == null && request.groupValue() == null && compiled.groupKey() != null) {
      groups = new ArrayList<>();
      for (Record g : compiler.groups(dsl, r).fetch()) {
        groups.add(
            new GroupInfo(g.get(0, String.class), g.get(1, String.class), g.get(2, Long.class)));
      }
    }
    List<DroppedField> dropped =
        prepared.dropped().stream().map(d -> new DroppedField(d.ref(), d.name())).toList();
    return new QueryResponse(items, next, groups, dropped);
  }
}
