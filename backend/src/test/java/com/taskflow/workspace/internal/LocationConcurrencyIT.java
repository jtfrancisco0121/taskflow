package com.taskflow.workspace.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.function.Supplier;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The nesting rules (Space > Folder > List) make a parent cycle impossible by type, so these tests
 * prove the real hazard: crossed and concurrent structural writes must leave every path equal to
 * its parent's path plus its own id, and ranks distinct.
 */
@DisplayName("LOC-1 concurrent structural writes")
class LocationConcurrencyIT extends IntegrationTest {

  private <T> List<T> race(List<Supplier<T>> actions) throws Exception {
    CountDownLatch go = new CountDownLatch(1);
    List<CompletableFuture<T>> futures = new ArrayList<>();
    for (Supplier<T> action : actions) {
      futures.add(
          CompletableFuture.supplyAsync(() -> {
            try {
              go.await();
            } catch (InterruptedException e) {
              throw new IllegalStateException(e);
            }
            return action.get();
          }));
    }
    go.countDown();
    List<T> results = new ArrayList<>();
    for (CompletableFuture<T> f : futures) {
      results.add(f.get());
    }
    return results;
  }

  /** Every row's path equals its parent's path plus its own label; no parent cycle exists. */
  private void assertPathsConsistent(UUID workspaceId) {
    Integer broken =
        jdbc.queryForObject(
            "SELECT count(*) FROM location c LEFT JOIN location p ON p.id = c.parent_id WHERE"
                + " c.workspace_id = ? AND c.path::text <> CASE WHEN c.parent_id IS NULL THEN"
                + " replace(c.id::text, '-', '') ELSE p.path::text || '.' || replace(c.id::text, '-',"
                + " '') END",
            Integer.class,
            workspaceId);
    assertThat(broken).isZero();
  }

  @Test
  void crossedMovesBetweenSpacesKeepEveryPathConsistent() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID s1 = space(ws.owner(), ws.id(), "S1");
    UUID s2 = space(ws.owner(), ws.id(), "S2");
    UUID x = folder(ws.member(), s1, "X");
    UUID y = folder(ws.member(), s2, "Y");
    UUID lx = list(ws.member(), x, "LX");
    UUID ly = list(ws.member(), y, "LY");

    List<Integer> statuses =
        race(
            List.of(
                () ->
                    post(
                            "/api/v1/locations/" + x + "/move",
                            ws.member().token(),
                            Map.of("parentId", s2))
                        .status(),
                () ->
                    post(
                            "/api/v1/locations/" + y + "/move",
                            ws.member().token(),
                            Map.of("parentId", s1))
                        .status(),
                () ->
                    post(
                            "/api/v1/locations/" + lx + "/move",
                            ws.member().token(),
                            Map.of("parentId", s1))
                        .status(),
                () ->
                    post(
                            "/api/v1/locations/" + ly + "/move",
                            ws.member().token(),
                            Map.of("parentId", s2))
                        .status()));
    assertThat(statuses).allMatch(s -> s == 200);
    assertPathsConsistent(ws.id());
    assertThat(jdbc.queryForObject("SELECT parent_id FROM location WHERE id = ?", UUID.class, x))
        .isEqualTo(s2);
    assertThat(jdbc.queryForObject("SELECT parent_id FROM location WHERE id = ?", UUID.class, y))
        .isEqualTo(s1);
  }

  @Test
  void aListCreatedWhileItsFolderMovesEndsUnderTheFoldersNewPath() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID s1 = space(ws.owner(), ws.id(), "S1");
    UUID s2 = space(ws.owner(), ws.id(), "S2");
    UUID x = folder(ws.member(), s1, "X");

    List<Integer> statuses =
        race(
            List.of(
                () ->
                    post(
                            "/api/v1/locations/" + x + "/move",
                            ws.member().token(),
                            Map.of("parentId", s2))
                        .status(),
                () ->
                    post(
                            "/api/v1/locations",
                            ws.member().token(),
                            Map.of("type", "LIST", "parentId", x, "name", "N1"))
                        .status(),
                () ->
                    post(
                            "/api/v1/locations",
                            ws.member().token(),
                            Map.of("type", "LIST", "parentId", x, "name", "N2"))
                        .status()));
    assertThat(statuses).allMatch(s -> s == 200 || s == 201);
    assertPathsConsistent(ws.id());
    String folderPath =
        jdbc.queryForObject("SELECT path::text FROM location WHERE id = ?", String.class, x);
    assertThat(folderPath).startsWith(s2.toString().replace("-", ""));
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM location WHERE parent_id = ? AND path::text LIKE ?",
                Integer.class,
                x,
                folderPath + ".%"))
        .isEqualTo(3);
  }

  @Test
  void parallelAppendsGetDistinctRanksAndALaterMoveBetweenThemSucceeds() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID space = space(ws.owner(), ws.id(), "S");
    List<Supplier<Integer>> creates = new ArrayList<>();
    for (int i = 0; i < 12; i++) {
      String name = "L" + i;
      creates.add(() ->
          post(
                  "/api/v1/locations",
                  ws.member().token(),
                  Map.of("type", "LIST", "parentId", space, "name", name))
              .status());
    }
    assertThat(race(creates)).allMatch(s -> s == 201);
    List<String> ranks =
        jdbc.queryForList(
            "SELECT rank FROM location WHERE parent_id = ? ORDER BY rank COLLATE \"C\"",
            String.class,
            space);
    assertThat(ranks).hasSize(12).doesNotHaveDuplicates();

    List<UUID> ordered = treeIds(ws.member(), ws.id(), space, false);
    UUID mover = ordered.get(ordered.size() - 1);
    Resp r =
        post(
            "/api/v1/locations/" + mover + "/move",
            ws.member().token(),
            Map.of("beforeId", ordered.get(1)));
    assertThat(r.status()).isEqualTo(200);
    List<UUID> after = treeIds(ws.member(), ws.id(), space, false);
    assertThat(after.indexOf(mover)).isEqualTo(1);
  }

  @Test
  void concurrentMoveAndArchiveOfNeighbouringSubtreesStayConsistent() throws Exception {
    Ws ws = workspaceWithAllRoles();
    UUID s1 = space(ws.owner(), ws.id(), "S1");
    UUID s2 = space(ws.owner(), ws.id(), "S2");
    UUID x = folder(ws.member(), s1, "X");
    list(ws.member(), x, "inner");
    List<Integer> statuses =
        race(
            List.of(
                () ->
                    post(
                            "/api/v1/locations/" + x + "/move",
                            ws.member().token(),
                            Map.of("parentId", s2))
                        .status(),
                () ->
                    post("/api/v1/locations/" + x + "/archive", ws.member().token(), null).status(),
                () ->
                    patch("/api/v1/locations/" + s1, ws.owner().token(), Map.of("name", "Renamed"))
                        .status()));
    assertThat(statuses).allMatch(s -> s == 200 || s == 409);
    assertPathsConsistent(ws.id());
  }
}
