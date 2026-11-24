package com.taskflow.identity.internal;

import com.taskflow.identity.UserDirectory;
import com.taskflow.identity.UserInfo;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

@Component
class UserDirectoryImpl implements UserDirectory {

  private static final RowMapper<UserInfo> MAPPER =
      (rs, i) ->
          new UserInfo(
              rs.getObject("id", UUID.class), rs.getString("email"), rs.getString("display_name"));

  private final JdbcTemplate jdbc;

  UserDirectoryImpl(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public Optional<UserInfo> byId(UUID id) {
    return jdbc
        .query("SELECT id, email, display_name FROM app_user WHERE id = ?", MAPPER, id)
        .stream()
        .findFirst();
  }

  @Override
  public Optional<UserInfo> byEmail(String email) {
    return jdbc
        .query(
            "SELECT id, email, display_name FROM app_user WHERE lower(email) = lower(?)"
                + " AND kind = 'HUMAN'",
            MAPPER,
            email.trim())
        .stream()
        .findFirst();
  }

  @Override
  public Map<UUID, UserInfo> byIds(Collection<UUID> ids) {
    Map<UUID, UserInfo> out = new LinkedHashMap<>();
    if (ids.isEmpty()) {
      return out;
    }
    String marks = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
    jdbc.query(
            "SELECT id, email, display_name FROM app_user WHERE id IN (" + marks + ")",
            MAPPER,
            ids.toArray())
        .forEach(u -> out.put(u.id(), u));
    return out;
  }
}
