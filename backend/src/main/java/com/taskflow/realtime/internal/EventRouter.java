package com.taskflow.realtime.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.taskflow.workspace.LocationInfo;
import com.taskflow.workspace.LocationTree;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * Where an event goes (AD-14). A task event goes to its own topic and to the Location topics from
 * its List up to the nearest private ancestor-or-self (or the Space); the Workspace topic gets it
 * only when no Location on that path is private. Location events follow the same rule starting at
 * the parent. Routing uses the event's {@code listId} or {@code path} and a cached id-to-Location
 * map per Workspace, cleared whenever a location event arrives (privacy, moves, deletes).
 */
@Component
class EventRouter {

  private final LocationTree tree;
  private final Map<UUID, Map<UUID, Optional<LocationInfo>>> cache = new ConcurrentHashMap<>();

  EventRouter(LocationTree tree) {
    this.tree = tree;
  }

  /** Topics for an event envelope; empty when there is nowhere safe to send it. */
  List<String> topics(
      UUID workspaceId, String entity, UUID entityId, String type, JsonNode payload) {
    Set<String> out = new LinkedHashSet<>();
    switch (entity) {
      case "task" -> {
        out.add("/topic/task/" + entityId);
        UUID listId = uuid(payload.get("listId"));
        UUID fromList = uuid(payload.get("fromListId"));
        for (UUID list : new UUID[] {listId, fromList}) {
          if (list != null) {
            chain(workspaceId, list, out, true);
          }
        }
      }
      case "location" -> {
        invalidate(workspaceId);
        out.add("/topic/location/" + entityId);
        Optional<LocationInfo> self = find(workspaceId, entityId);
        boolean privateNow = self.map(LocationInfo::isPrivate).orElse(false);
        if (privateNow && !type.equals("location.privacy_changed")) {
          // a private Location's own events stay at or below it
          break;
        }
        UUID parent = uuid(payload.get("parentId"));
        if (parent != null) {
          chain(workspaceId, parent, out, true);
        } else if (!privateNow || type.equals("location.privacy_changed")) {
          out.add("/topic/workspace/" + workspaceId);
        }
        UUID fromParent = uuid(payload.get("fromParentId"));
        if (fromParent != null) {
          chain(workspaceId, fromParent, out, true);
        } else if (payload.has("fromParentId") && payload.get("fromParentId").isNull()) {
          out.add("/topic/workspace/" + workspaceId);
        }
      }
      case "automation" -> {
        // Rule changes follow the Location chain of the rule's Location (AD-12).
        UUID locationId = uuid(payload.get("locationId"));
        if (locationId != null) {
          chain(workspaceId, locationId, out, false);
        }
      }
      // Service account and key administration is not for members' eyes (AD-9): no topic.
      case "service_account", "api_key" -> {}
      default -> out.add("/topic/workspace/" + workspaceId);
    }
    return new ArrayList<>(out);
  }

  /**
   * Adds the Location topics from {@code start} up to the nearest private one, then the Workspace.
   */
  private void chain(UUID workspaceId, UUID start, Set<String> out, boolean withWorkspace) {
    Optional<LocationInfo> first = find(workspaceId, start);
    if (first.isEmpty()) {
      return;
    }
    boolean open = true;
    for (UUID id : first.get().selfAndAncestorIds()) {
      out.add("/topic/location/" + id);
      boolean isPrivate = find(workspaceId, id).map(LocationInfo::isPrivate).orElse(true);
      if (isPrivate) {
        open = false;
        break;
      }
    }
    if (open && withWorkspace) {
      out.add("/topic/workspace/" + workspaceId);
    }
  }

  private Optional<LocationInfo> find(UUID workspaceId, UUID id) {
    return cache
        .computeIfAbsent(workspaceId, w -> new ConcurrentHashMap<>())
        .computeIfAbsent(id, i -> tree.find(i).filter(l -> l.workspaceId().equals(workspaceId)));
  }

  void invalidate(UUID workspaceId) {
    cache.remove(workspaceId);
  }

  private static UUID uuid(JsonNode n) {
    if (n == null || n.isNull()) {
      return null;
    }
    try {
      return UUID.fromString(n.asText());
    } catch (IllegalArgumentException e) {
      return null;
    }
  }
}
