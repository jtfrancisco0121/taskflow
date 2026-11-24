package com.taskflow.field.internal;

import com.taskflow.field.StatusCatalog;
import com.taskflow.field.StatusGroup;
import com.taskflow.field.StatusInfo;
import com.taskflow.field.StatusSetChanged;
import com.taskflow.shared.EventRecorder;
import com.taskflow.shared.Ids;
import com.taskflow.shared.RankService;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.LocationCreated;
import com.taskflow.workspace.LocationInfo;
import com.taskflow.workspace.LocationTree;
import com.taskflow.workspace.LocationType;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Status sets with inheritance and defaults (STAT-1, STAT-2). */
@Service
class StatusService {

  static final int MAX_STATUSES = 30;
  private static final Pattern COLOR = Pattern.compile("^#[0-9a-fA-F]{6}$");

  /** One status of a replacement set; {@code id} is set for a status that is kept. */
  record StatusDraft(UUID id, String name, StatusGroup group, String color) {}

  /** Where a removed status goes: the name of a status in the new effective set. */
  record Remap(UUID from, String to) {}

  record StatusSetView(
      UUID locationId, UUID definedAt, UUID inheritedFrom, List<StatusInfo> statuses) {}

  private static final List<StatusDraft> DEFAULTS =
      List.of(
          new StatusDraft(null, "to do", StatusGroup.NOT_STARTED, "#9ca3af"),
          new StatusDraft(null, "in progress", StatusGroup.ACTIVE, "#3b82f6"),
          new StatusDraft(null, "complete", StatusGroup.DONE, "#22c55e"),
          new StatusDraft(null, "closed", StatusGroup.CLOSED, "#6b7280"));

  private final JdbcTemplate jdbc;
  private final StatusCatalog catalog;
  private final LocationTree tree;
  private final EventRecorder events;
  private final ApplicationEventPublisher publisher;

  StatusService(
      JdbcTemplate jdbc,
      StatusCatalog catalog,
      LocationTree tree,
      EventRecorder events,
      ApplicationEventPublisher publisher) {
    this.jdbc = jdbc;
    this.catalog = catalog;
    this.tree = tree;
    this.events = events;
    this.publisher = publisher;
  }

  /** STAT-2: every new Space starts with the default set, in the Space's own transaction. */
  @EventListener
  void seedDefaults(LocationCreated created) {
    if (created.type() == LocationType.SPACE) {
      insertSet(created.workspaceId(), created.locationId(), DEFAULTS);
    }
  }

  @Transactional(readOnly = true)
  StatusSetView get(UUID locationId) {
    LocationInfo location = location(locationId);
    List<StatusInfo> set = catalog.effectiveSet(locationId);
    UUID definedAt = set.isEmpty() ? null : set.get(0).definedAt();
    return new StatusSetView(
        locationId,
        definedAt,
        definedAt == null || definedAt.equals(location.id()) ? null : definedAt,
        set);
  }

  @Transactional
  StatusSetView replace(UUID locationId, List<StatusDraft> drafts, List<Remap> remaps) {
    LocationInfo location = location(locationId);
    validate(drafts);
    List<StatusInfo> before = catalog.effectiveSet(locationId);
    List<StatusInfo> own = before.stream().filter(s -> s.definedAt().equals(locationId)).toList();
    Set<UUID> ownIds = new HashSet<>();
    own.forEach(s -> ownIds.add(s.id()));
    Set<UUID> keptIds = new HashSet<>();
    for (StatusDraft d : drafts) {
      if (d.id() != null) {
        if (!ownIds.contains(d.id())) {
          throw TaskflowException.badRequest(
              "status.unknown_id", "Status " + d.id() + " is not part of this location's own set");
        }
        keptIds.add(d.id());
      }
    }
    // Everything the location resolved before that the new own set does not keep must move.
    Set<UUID> removed = new HashSet<>();
    for (StatusInfo s : before) {
      if (!keptIds.contains(s.id())) {
        removed.add(s.id());
      }
    }
    Map<String, UUID> newIdsByName = new LinkedHashMap<>();
    Map<UUID, UUID> resolvedRemap = new HashMap<>();
    List<StatusDraft> finalDrafts = new ArrayList<>();
    // Assign ids first so a remap can target a status that is new in this call.
    for (StatusDraft d : drafts) {
      UUID id = d.id() != null ? d.id() : Ids.newId();
      newIdsByName.put(d.name().trim().toLowerCase(Locale.ROOT), id);
      finalDrafts.add(new StatusDraft(id, d.name().trim(), d.group(), d.color()));
    }
    resolveRemap(removed, remaps, newIdsByName, resolvedRemap);
    // Rewrite the own rows: retire what is gone, update what is kept, insert what is new.
    for (StatusInfo s : own) {
      if (!keptIds.contains(s.id())) {
        jdbc.update("UPDATE status SET retired_at = now() WHERE id = ?", s.id());
      }
    }
    List<String> ranks = RankService.spread(finalDrafts.size());
    for (int i = 0; i < finalDrafts.size(); i++) {
      StatusDraft d = finalDrafts.get(i);
      if (keptIds.contains(d.id())) {
        jdbc.update(
            "UPDATE status SET name = ?, status_group = ?, color = ?, rank = ? WHERE id = ?",
            d.name(),
            d.group().name(),
            color(d.color()),
            ranks.get(i),
            d.id());
      } else {
        jdbc.update(
            "INSERT INTO status (id, workspace_id, location_id, name, status_group, color, rank)"
                + " VALUES (?, ?, ?, ?, ?, ?, ?)",
            d.id(),
            location.workspaceId(),
            locationId,
            d.name(),
            d.group().name(),
            color(d.color()),
            ranks.get(i));
      }
    }
    changed(location, resolvedRemap, "replaced");
    return get(locationId);
  }

  @Transactional
  StatusSetView reset(UUID locationId, List<Remap> remaps) {
    LocationInfo location = location(locationId);
    if (location.type() == LocationType.SPACE) {
      throw TaskflowException.conflict(
          "status.space_needs_set", "A Space defines its own statuses and cannot inherit");
    }
    List<StatusInfo> before = catalog.effectiveSet(locationId);
    List<StatusInfo> own = before.stream().filter(s -> s.definedAt().equals(locationId)).toList();
    if (own.isEmpty()) {
      throw TaskflowException.conflict(
          "status.not_overridden", "This location already inherits its statuses");
    }
    for (StatusInfo s : own) {
      jdbc.update("UPDATE status SET retired_at = now() WHERE id = ?", s.id());
    }
    List<StatusInfo> inherited = catalog.effectiveSet(locationId);
    Map<String, UUID> byName = new HashMap<>();
    inherited.forEach(s -> byName.put(s.name().toLowerCase(Locale.ROOT), s.id()));
    Set<UUID> removed = new HashSet<>();
    own.forEach(s -> removed.add(s.id()));
    Map<UUID, UUID> resolved = new HashMap<>();
    resolveRemap(removed, remaps, byName, resolved);
    changed(location, resolved, "reset");
    return get(locationId);
  }

  private void resolveRemap(
      Set<UUID> removed, List<Remap> remaps, Map<String, UUID> targets, Map<UUID, UUID> out) {
    Map<UUID, String> requested = new HashMap<>();
    for (Remap r : remaps) {
      requested.put(r.from(), r.to());
    }
    for (UUID id : removed) {
      String to = requested.get(id);
      if (to == null) {
        throw TaskflowException.badRequest(
                "status.remap_required", "Removed status " + id + " needs a remap target")
            .with("statusId", id.toString());
      }
      UUID target = targets.get(to.trim().toLowerCase(Locale.ROOT));
      if (target == null) {
        throw TaskflowException.badRequest(
                "status.remap_target_unknown", "Remap target '" + to + "' is not in the new set")
            .with("statusId", id.toString());
      }
      out.put(id, target);
    }
    for (UUID from : requested.keySet()) {
      if (!removed.contains(from)) {
        throw TaskflowException.badRequest(
            "status.remap_not_removed", "Status " + from + " is not being removed");
      }
    }
  }

  /** parentId and path let subscribers route the event (AD-12). */
  private static Map<String, Object> locationPayload(
      LocationInfo location, String how, int remapped) {
    Map<String, Object> m = new java.util.LinkedHashMap<>();
    m.put("parentId", location.parentId() == null ? null : location.parentId().toString());
    m.put("path", location.path());
    m.put("change", how);
    m.put("remapped", remapped);
    return m;
  }

  private void changed(LocationInfo location, Map<UUID, UUID> remap, String how) {
    events.record(
        location.workspaceId(),
        "location",
        location.id(),
        "status_set.changed",
        locationPayload(location, how, remap.size()));
    publisher.publishEvent(new StatusSetChanged(location.workspaceId(), location.id(), remap));
  }

  private void insertSet(UUID workspaceId, UUID locationId, List<StatusDraft> drafts) {
    List<String> ranks = RankService.spread(drafts.size());
    for (int i = 0; i < drafts.size(); i++) {
      StatusDraft d = drafts.get(i);
      jdbc.update(
          "INSERT INTO status (id, workspace_id, location_id, name, status_group, color, rank)"
              + " VALUES (?, ?, ?, ?, ?, ?, ?)",
          Ids.newId(),
          workspaceId,
          locationId,
          d.name(),
          d.group().name(),
          color(d.color()),
          ranks.get(i));
    }
  }

  static void validate(List<StatusDraft> drafts) {
    if (drafts == null || drafts.isEmpty() || drafts.size() > MAX_STATUSES) {
      throw TaskflowException.badRequest(
          "status.invalid_set", "A set has between 1 and " + MAX_STATUSES + " statuses");
    }
    Set<String> names = new HashSet<>();
    boolean notStarted = false;
    boolean finished = false;
    for (StatusDraft d : drafts) {
      if (d.name() == null || d.name().isBlank() || d.name().trim().length() > 50) {
        throw TaskflowException.badRequest(
            "status.invalid_name", "Status names are 1 to 50 characters");
      }
      if (d.group() == null) {
        throw TaskflowException.badRequest("status.invalid_group", "Every status needs a group");
      }
      if (!names.add(d.name().trim().toLowerCase(Locale.ROOT))) {
        throw TaskflowException.badRequest(
            "status.duplicate_name", "Status names must be unique within a set");
      }
      if (d.color() != null && !COLOR.matcher(d.color()).matches()) {
        throw TaskflowException.badRequest("status.invalid_color", "Colors look like #3b82f6");
      }
      notStarted |= d.group() == StatusGroup.NOT_STARTED;
      finished |= d.group() == StatusGroup.DONE || d.group() == StatusGroup.CLOSED;
    }
    if (!notStarted) {
      throw TaskflowException.badRequest(
          "status.needs_not_started", "A set needs at least one NOT_STARTED status");
    }
    if (!finished) {
      throw TaskflowException.badRequest(
          "status.needs_done", "A set needs at least one DONE or CLOSED status");
    }
  }

  private static String color(String color) {
    return color == null ? "#9ca3af" : color.toLowerCase(Locale.ROOT);
  }

  private LocationInfo location(UUID id) {
    return tree.find(id)
        .filter(l -> !l.deleted())
        .orElseThrow(() -> TaskflowException.notFound("location.not_found", "Location not found"));
  }
}
