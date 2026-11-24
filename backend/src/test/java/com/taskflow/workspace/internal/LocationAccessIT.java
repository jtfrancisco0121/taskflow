package com.taskflow.workspace.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import com.taskflow.workspace.LocationAccess;
import com.taskflow.workspace.Role;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

/** The shared SQL fragment itself, per role, against real rows (CAP-8, CAP-23). */
@DisplayName("LOC-3 visibility fragment")
class LocationAccessIT extends IntegrationTest {

  @Autowired NamedParameterJdbcTemplate named;

  private List<UUID> visibleTo(UUID workspace, UUID user, Role role) {
    MapSqlParameterSource params = new MapSqlParameterSource(LocationAccess.params(user, role));
    params.addValue("w", workspace);
    return named.queryForList(
        "SELECT l.id FROM location l WHERE l.workspace_id = :w AND "
            + LocationAccess.visible("l")
            + " ORDER BY l.id",
        params,
        UUID.class);
  }

  @Test
  void ownerAndAdminSeeEverythingLiveMemberAndGuestFollowTheGrants() {
    Ws ws = workspaceWithAllRoles();
    UUID open = space(ws.owner(), ws.id(), "Open");
    UUID secret =
        location(
            ws.owner(),
            Map.of("type", "SPACE", "workspaceId", ws.id(), "name", "Secret", "isPrivate", true));
    UUID secretList = list(ws.owner(), secret, "inside");
    UUID deleted = list(ws.owner(), open, "deleted");
    delete("/api/v1/locations/" + deleted, ws.owner().token());

    assertThat(visibleTo(ws.id(), ws.owner().id(), Role.OWNER))
        .containsExactlyInAnyOrder(open, secret, secretList);
    assertThat(visibleTo(ws.id(), ws.admin().id(), Role.ADMIN))
        .containsExactlyInAnyOrder(open, secret, secretList);
    assertThat(visibleTo(ws.id(), ws.member().id(), Role.MEMBER)).containsExactly(open);
    assertThat(visibleTo(ws.id(), ws.guest().id(), Role.GUEST)).isEmpty();

    put("/api/v1/locations/" + secret + "/grants/" + ws.member().id(), ws.owner().token(), null);
    put("/api/v1/locations/" + secretList + "/grants/" + ws.guest().id(), ws.owner().token(), null);
    assertThat(visibleTo(ws.id(), ws.member().id(), Role.MEMBER))
        .containsExactlyInAnyOrder(open, secret, secretList);
    assertThat(visibleTo(ws.id(), ws.guest().id(), Role.GUEST)).containsExactly(secretList);
  }
}
