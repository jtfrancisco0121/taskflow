package com.taskflow.task.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("DEP-5 relationship writes are permission-checked and scoped")
class DependencyPermissionsIT extends DependencyTestBase {

  @Test
  void aGuestCannotAddOrRemoveAndAnInvisibleTaskIs404() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID a = task(m, f.list(), "A");
    UUID b = task(m, f.list(), "B");
    UUID dep = relate(m, a, "WAITING_ON", b).uuid("/dependency/id");
    TestUser guest = f.ws().guest();

    // a guest without a grant cannot even see the task
    assertThat(relate(guest, a, "WAITING_ON", b).status()).isEqualTo(404);
    assertThat(dependencies(guest, a).status()).isEqualTo(404);
    put("/api/v1/locations/" + f.space() + "/grants/" + guest.id(), f.ws().owner().token(), null);
    // granted: the guest sees the relationships but cannot edit them
    assertThat(dependencies(guest, a).status()).isEqualTo(200);
    assertThat(relate(guest, a, "LINKED", b).status()).isEqualTo(403);
    assertThat(unrelate(guest, a, dep).status()).isEqualTo(403);

    UUID privateList =
        location(
            f.ws().owner(),
            Map.of("type", "LIST", "parentId", f.space(), "name", "Private", "isPrivate", true));
    UUID secret = task(f.ws().owner(), privateList, "Secret");
    assertThat(relate(m, a, "WAITING_ON", secret).status()).isEqualTo(404);
    assertThat(relate(m, secret, "WAITING_ON", a).status()).isEqualTo(404);
    assertThat(count("task_dependency", f.ws().id())).isEqualTo(1);
  }

  @Test
  void removingByAnIdThatDoesNotTouchThePathTaskOrBelongsToAnotherWorkspaceIs404() {
    Fix f = fixture();
    TestUser m = f.ws().member();
    UUID x = task(m, f.list(), "X");
    UUID y = task(m, f.list(), "Y");
    UUID z = task(m, f.list(), "Z");
    UUID yz = relate(m, y, "WAITING_ON", z).uuid("/dependency/id");

    Fix other = fixture();
    TestUser om = other.ws().member();
    UUID p = task(om, other.list(), "P");
    UUID q = task(om, other.list(), "Q");
    UUID pq = relate(om, p, "WAITING_ON", q).uuid("/dependency/id");
    // the caller is a member of both workspaces
    addMember(other.ws().id(), m, "MEMBER");

    long vx = version(m, x);
    long vy = version(m, y);
    long vz = version(m, z);
    for (UUID foreign : new UUID[] {yz, pq, UUID.randomUUID()}) {
      Resp r = unrelate(m, x, foreign);
      assertThat(r.status()).as(foreign.toString()).isEqualTo(404);
      assertThat(r.at("/code").asText()).isEqualTo("dependency.not_found");
    }
    // x is in the workspace of the row pq, but it is not an end of it: also 404 from p's view
    assertThat(unrelate(m, p, yz).status()).isEqualTo(404);
    assertThat(jdbc.queryForObject("SELECT count(*) FROM task_dependency", Integer.class))
        .isGreaterThanOrEqualTo(2);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM task_dependency WHERE id IN (?, ?)", Integer.class, yz, pq))
        .isEqualTo(2);
    assertThat(version(m, x)).isEqualTo(vx);
    assertThat(version(m, y)).isEqualTo(vy);
    assertThat(version(m, z)).isEqualTo(vz);
  }
}
