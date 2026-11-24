package com.taskflow.notification.internal;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Per-person preferences per Workspace and kind (CAP-13). A missing row is the default. */
@Component
class PreferenceStore {

  static final List<String> KINDS =
      List.of(
          "ASSIGNED",
          "MENTIONED",
          "COMMENTED",
          "STATUS_CHANGED",
          "DUE_SOON",
          "BLOCKER_RESOLVED",
          "AUTOMATION");

  record Preference(String kind, boolean inApp, boolean emailDigest) {}

  private final JdbcTemplate jdbc;

  PreferenceStore(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  static Preference defaultFor(String kind) {
    return new Preference(kind, true, kind.equals("ASSIGNED") || kind.equals("MENTIONED"));
  }

  boolean inApp(UUID workspaceId, UUID userId, String kind) {
    return get(workspaceId, userId, kind).inApp();
  }

  boolean emailDigest(UUID workspaceId, UUID userId, String kind) {
    return get(workspaceId, userId, kind).emailDigest();
  }

  Preference get(UUID workspaceId, UUID userId, String kind) {
    return jdbc
        .query(
            "SELECT in_app, email_digest FROM notification_preference WHERE workspace_id = ? AND"
                + " user_id = ? AND kind = ?",
            (rs, i) -> new Preference(kind, rs.getBoolean("in_app"), rs.getBoolean("email_digest")),
            workspaceId,
            userId,
            kind)
        .stream()
        .findFirst()
        .orElseGet(() -> defaultFor(kind));
  }

  /** Every kind, defaults filled in, in catalogue order. */
  List<Preference> all(UUID workspaceId, UUID userId) {
    Map<String, Preference> byKind = new LinkedHashMap<>();
    KINDS.forEach(k -> byKind.put(k, defaultFor(k)));
    jdbc.query(
        "SELECT kind, in_app, email_digest FROM notification_preference WHERE workspace_id = ? AND"
            + " user_id = ?",
        rs -> {
          String kind = rs.getString("kind");
          byKind.put(
              kind, new Preference(kind, rs.getBoolean("in_app"), rs.getBoolean("email_digest")));
        },
        workspaceId,
        userId);
    return List.copyOf(byKind.values());
  }

  void save(UUID workspaceId, UUID userId, Preference p) {
    jdbc.update(
        "INSERT INTO notification_preference (workspace_id, user_id, kind, in_app, email_digest)"
            + " VALUES (?, ?, ?, ?, ?) ON CONFLICT (workspace_id, user_id, kind) DO UPDATE SET"
            + " in_app = EXCLUDED.in_app, email_digest = EXCLUDED.email_digest, updated_at = now()",
        workspaceId,
        userId,
        p.kind(),
        p.inApp(),
        p.emailDigest());
  }
}
