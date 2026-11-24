package com.taskflow.workspace;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** A location row as other modules may see it, whatever its visibility. */
public record LocationInfo(
    UUID id,
    UUID workspaceId,
    UUID parentId,
    LocationType type,
    String name,
    String path,
    boolean isPrivate,
    boolean archived,
    boolean deleted) {

  /** Ids of this location and its ancestors, nearest first (self, parent, ..., Space). */
  public List<UUID> selfAndAncestorIds() {
    String[] labels = path.split("\\.");
    List<UUID> ids = new ArrayList<>(labels.length);
    for (int i = labels.length - 1; i >= 0; i--) {
      String h = labels[i];
      ids.add(
          UUID.fromString(
              h.substring(0, 8)
                  + "-"
                  + h.substring(8, 12)
                  + "-"
                  + h.substring(12, 16)
                  + "-"
                  + h.substring(16, 20)
                  + "-"
                  + h.substring(20)));
    }
    return ids;
  }
}
