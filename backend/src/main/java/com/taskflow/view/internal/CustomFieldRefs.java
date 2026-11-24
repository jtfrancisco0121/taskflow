package com.taskflow.view.internal;

import com.taskflow.field.CustomFieldSql;
import com.taskflow.field.FieldCatalog;
import com.taskflow.field.FieldInfo;
import com.taskflow.shared.TaskflowException;
import com.taskflow.view.ViewConfig;
import com.taskflow.workspace.LocationInfo;
import com.taskflow.workspace.LocationTree;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Resolves the {@code cf:<fieldId>} references of a view config (AD-8). Saving a view refuses a
 * reference that is not a live field on the scope's branch (defined at the scope, an ancestor or a
 * descendant; at Workspace scope any live field of the Workspace). A query drops such references
 * instead, so a saved view keeps working after a field is retired, and names them in {@code
 * droppedFields}. All custom SQL comes from {@link CustomFieldSql}; this class only decides what is
 * live.
 */
@Component
class CustomFieldRefs {

  /** A reference a query dropped: the {@code cf:<id>} text and the field's name when known. */
  record Dropped(String ref, String name) {}

  /** The config a query runs and what it dropped; {@code bound} is keyed by {@code cf:<id>}. */
  record Prepared(
      ViewConfig config, Map<String, CustomFieldSql.Bound> bound, List<Dropped> dropped) {}

  private final FieldCatalog catalog;
  private final CustomFieldSql sql;
  private final LocationTree tree;

  CustomFieldRefs(FieldCatalog catalog, CustomFieldSql sql, LocationTree tree) {
    this.catalog = catalog;
    this.sql = sql;
    this.tree = tree;
  }

  /** Every {@code cf:} reference of a config, in first-use order. */
  static Set<String> references(ViewConfig c) {
    Set<String> out = new LinkedHashSet<>();
    collect(c.filter(), out);
    if (c.sort() != null) {
      for (ViewConfig.Sort s : c.sort()) {
        add(out, s.key());
      }
    }
    add(out, c.group());
    if (c.columns() != null) {
      for (ViewConfig.Column col : c.columns()) {
        add(out, col.field());
      }
    }
    return out;
  }

  private static void collect(ViewConfig.Filter f, Set<String> out) {
    if (f == null) {
      return;
    }
    if (f.items() != null) {
      f.items().forEach(i -> collect(i, out));
    } else {
      add(out, f.field());
    }
  }

  private static void add(Set<String> out, String ref) {
    if (ViewConfigValidator.customReference(ref)) {
      out.add(ref);
    }
  }

  /**
   * Save: every reference must be a live field on the branch of {@code scope} (null: Workspace).
   */
  void checkForSave(ViewConfig config, LocationInfo scope, UUID workspaceId) {
    for (String ref : references(config)) {
      Optional<FieldInfo> field = live(ref, scope, workspaceId);
      if (field.isEmpty()) {
        throw ViewConfigValidator.invalid(
            "The custom field " + ref + " is not a live field of this view's place");
      }
    }
    checkUses(config, bind(references(config), scope, workspaceId).bound());
  }

  /** Query: drops references that are not live, validates the rest and binds their guards. */
  Prepared prepare(ViewConfig config, LocationInfo scope, UUID workspaceId) {
    Set<String> refs = references(config);
    if (refs.isEmpty()) {
      return new Prepared(config, Map.of(), List.of());
    }
    Prepared p = bind(refs, scope, workspaceId);
    if (p.dropped().isEmpty()) {
      checkUses(config, p.bound());
      return new Prepared(config, p.bound(), p.dropped());
    }
    Set<String> gone = new LinkedHashSet<>();
    p.dropped().forEach(d -> gone.add(d.ref()));
    ViewConfig kept = without(config, gone);
    checkUses(kept, p.bound());
    return new Prepared(kept, p.bound(), p.dropped());
  }

  private Prepared bind(Set<String> refs, LocationInfo scope, UUID workspaceId) {
    Map<String, CustomFieldSql.Bound> bound = new LinkedHashMap<>();
    List<Dropped> dropped = new ArrayList<>();
    for (String ref : refs) {
      Optional<FieldInfo> field = live(ref, scope, workspaceId);
      if (field.isPresent()) {
        bound.put(ref, sql.bind(field.get()));
      } else {
        String name =
            catalog.lookup(UUID.fromString(ref.substring(3))).map(FieldInfo::name).orElse(null);
        dropped.add(new Dropped(ref, name));
      }
    }
    return new Prepared(null, bound, dropped);
  }

  private Optional<FieldInfo> live(String ref, LocationInfo scope, UUID workspaceId) {
    return catalog
        .lookup(UUID.fromString(ref.substring(3)))
        .filter(f -> !f.retired() && f.workspaceId().equals(workspaceId))
        .filter(f -> scope == null || onBranch(f, scope));
  }

  /** Defined at the scope, an ancestor of it or a descendant of it. */
  private boolean onBranch(FieldInfo f, LocationInfo scope) {
    return tree.find(f.definedAt())
        .map(at -> related(at.path(), scope.path()) || related(scope.path(), at.path()))
        .orElse(false);
  }

  /** {@code a} is {@code b} or lies under it (ltree paths). */
  private static boolean related(String a, String b) {
    return a.equals(b) || a.startsWith(b + ".");
  }

  /** The operator, sort and group rules of each used field's type. */
  private static void checkUses(ViewConfig c, Map<String, CustomFieldSql.Bound> bound) {
    checkFilter(c.filter(), bound);
    if (c.sort() != null) {
      for (ViewConfig.Sort s : c.sort()) {
        CustomFieldSql.Bound b = bound.get(s.key());
        if (b != null && !CustomFieldSql.sortable(b.field().type())) {
          throw ViewConfigValidator.invalid(b.field().name() + " cannot be used to sort");
        }
      }
    }
    CustomFieldSql.Bound g = c.group() == null ? null : bound.get(c.group());
    if (g != null && !CustomFieldSql.groupable(g.field().type())) {
      throw ViewConfigValidator.invalid(g.field().name() + " cannot be used to group");
    }
  }

  private static void checkFilter(ViewConfig.Filter f, Map<String, CustomFieldSql.Bound> bound) {
    if (f == null) {
      return;
    }
    if (f.items() != null) {
      f.items().forEach(i -> checkFilter(i, bound));
      return;
    }
    CustomFieldSql.Bound b = f.field() == null ? null : bound.get(f.field());
    if (b != null) {
      CustomFieldSql.validateCondition(b.field(), f.op(), f.value(), ViewConfigValidator::invalid);
    }
  }

  /** The config without the given references; a group left empty goes with them. */
  static ViewConfig without(ViewConfig c, Set<String> gone) {
    List<ViewConfig.Sort> sort =
        c.sort() == null ? null : c.sort().stream().filter(s -> !gone.contains(s.key())).toList();
    List<ViewConfig.Column> columns =
        c.columns() == null
            ? null
            : c.columns().stream().filter(col -> !gone.contains(col.field())).toList();
    return new ViewConfig(
        c.v(),
        prune(c.filter(), gone),
        gone.contains(c.group()) ? null : c.group(),
        sort == null || sort.isEmpty() ? null : sort,
        columns,
        c.mode());
  }

  private static ViewConfig.Filter prune(ViewConfig.Filter f, Set<String> gone) {
    if (f == null) {
      return null;
    }
    if (f.items() == null) {
      return gone.contains(f.field()) ? null : f;
    }
    List<ViewConfig.Filter> items = new ArrayList<>();
    for (ViewConfig.Filter child : f.items()) {
      ViewConfig.Filter kept = prune(child, gone);
      if (kept != null) {
        items.add(kept);
      }
    }
    return items.isEmpty() ? null : new ViewConfig.Filter(f.op(), null, f.value(), items);
  }

  static TaskflowException invalid(String message) {
    return ViewConfigValidator.invalid(message);
  }
}
