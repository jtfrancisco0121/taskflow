package com.taskflow.identity.internal;

import com.taskflow.identity.ApiKeyDirectory;
import com.taskflow.identity.ServiceAccounts;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
class ServiceAccountDirectoryImpl implements ServiceAccounts, ApiKeyDirectory {

  private final JdbcTemplate jdbc;

  ServiceAccountDirectoryImpl(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public Optional<UUID> workspaceOf(UUID serviceAccountId) {
    return jdbc
        .queryForList(
            "SELECT workspace_id FROM service_account WHERE id = ? AND disabled_at IS NULL",
            UUID.class,
            serviceAccountId)
        .stream()
        .findFirst();
  }

  @Override
  public Map<UUID, String> namesByIds(Collection<UUID> keyIds) {
    Map<UUID, String> out = new LinkedHashMap<>();
    if (keyIds.isEmpty()) {
      return out;
    }
    String marks = String.join(",", java.util.Collections.nCopies(keyIds.size(), "?"));
    jdbc.query(
        "SELECT id, name FROM api_key WHERE id IN (" + marks + ")",
        rs -> {
          out.put(rs.getObject("id", UUID.class), rs.getString("name"));
        },
        keyIds.toArray());
    return out;
  }
}
