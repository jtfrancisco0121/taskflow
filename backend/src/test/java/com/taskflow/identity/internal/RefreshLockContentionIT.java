package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

/**
 * ClickUp 14yq6g334r6 item 1: a dead token never queues on its family lock, and a request that
 * waits too long for a busy family gives up with 503 instead of holding a pool connection.
 */
@DisplayName("AUTH-2 refresh family lock contention")
@ExtendWith(OutputCaptureExtension.class)
class RefreshLockContentionIT extends IntegrationTest {

  @Autowired private DataSource dataSource;

  private ExecutorService pool;

  @BeforeEach
  void startPool() {
    pool = Executors.newSingleThreadExecutor();
  }

  @AfterEach
  void stopPool() {
    pool.shutdownNow();
  }

  private Resp signup() {
    return post(
        "/api/v1/auth/signup",
        null,
        Map.of("email", AuthIT.email(), "password", AuthIT.PASSWORD, "displayName", "Contention"));
  }

  private Resp refresh(String cookie) {
    return post("/api/v1/auth/refresh", null, null, "Cookie", cookie);
  }

  private Resp signOut(String cookie) {
    return post("/api/v1/auth/signout", null, null, "Cookie", cookie);
  }

  private static String hashOf(String cookie) {
    return AuthService.sha256(cookie.substring("refresh_token=".length()));
  }

  private UUID familyOf(String cookie) {
    return jdbc.queryForObject(
        "SELECT family_id FROM refresh_token WHERE token_hash = ?", UUID.class, hashOf(cookie));
  }

  /** Takes the family's advisory lock on its own connection, as a concurrent request would. */
  private Connection holdFamilyLock(UUID family) throws Exception {
    Connection c = dataSource.getConnection();
    c.setAutoCommit(false);
    try (PreparedStatement s =
        c.prepareStatement("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))")) {
      s.setString(1, "refresh_family:" + family);
      s.execute();
    }
    return c;
  }

  private static void release(Connection c) throws Exception {
    c.rollback();
    c.close();
  }

  /** Requests other than the holder waiting on this family's advisory lock. */
  private int waitersOn(UUID family, int holderPid) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objsubid = 1 AND NOT granted"
            + " AND pid <> ? AND ((classid::bigint << 32) | objid::bigint) ="
            + " hashtextextended(?, 0)",
        Integer.class,
        holderPid,
        "refresh_family:" + family);
  }

  private int liveTokensIn(UUID family) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM refresh_token WHERE family_id = ? AND revoked_at IS NULL",
        Integer.class,
        family);
  }

  private static int pidOf(Connection c) throws Exception {
    try (var rs = c.createStatement().executeQuery("SELECT pg_backend_pid()")) {
      rs.next();
      return rs.getInt(1);
    }
  }

  /** Polls pg_locks while the request runs; the most waiters seen on the family. */
  private int maxWaitersWhile(Future<Resp> request, UUID family, int holderPid) throws Exception {
    int max = 0;
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(1);
    while (!request.isDone() && System.nanoTime() < deadline) {
      max = Math.max(max, waitersOn(family, holderPid));
      Thread.sleep(20);
    }
    return max;
  }

  /** Blocks until a request other than the holder waits on the family's lock (at most 10 s). */
  private void awaitWaiterOn(UUID family, int holderPid) throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (waitersOn(family, holderPid) == 0) {
      assertThat(System.nanoTime()).as("a waiter on the family lock").isLessThan(deadline);
      Thread.sleep(20);
    }
  }

  @Test
  void aRevokedTokenIsRefusedWithoutWaitingOnItsFamilyLock() throws Exception {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    assertThat(signOut(a).status()).isEqualTo(204);
    UUID family = familyOf(a);

    Connection holder = holdFamilyLock(family);
    try {
      Future<Resp> request = pool.submit(() -> refresh(a));
      int waiters = maxWaitersWhile(request, family, pidOf(holder));

      assertThat(waiters).isZero();
      assertThat(request.get(5, TimeUnit.SECONDS).status()).isEqualTo(401);
    } finally {
      release(holder);
    }
  }

  @Test
  void anExpiredUnrotatedTokenIsRefusedWithoutWaitingOnItsFamilyLock() throws Exception {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    jdbc.update(
        "UPDATE refresh_token SET expires_at = now() - interval '1 second' WHERE token_hash = ?",
        hashOf(a));
    UUID family = familyOf(a);

    Connection holder = holdFamilyLock(family);
    try {
      Future<Resp> request = pool.submit(() -> refresh(a));
      int waiters = maxWaitersWhile(request, family, pidOf(holder));

      assertThat(waiters).isZero();
      assertThat(request.get(5, TimeUnit.SECONDS).status()).isEqualTo(401);
    } finally {
      release(holder);
    }
  }

  @Test
  void aRefreshThatWaitsTooLongForItsFamilyGets503AndRotatesNothing() throws Exception {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    UUID family = familyOf(a);

    Connection holder = holdFamilyLock(family);
    Resp answer;
    try {
      answer = pool.submit(() -> refresh(a)).get(15, TimeUnit.SECONDS);
    } finally {
      release(holder);
    }

    assertThat(answer.status()).isEqualTo(503);
    assertThat(answer.headers().getFirst("Retry-After")).isEqualTo("1");
    assertThat(answer.text("/code")).isEqualTo("request.busy");
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM refresh_token WHERE family_id = ? AND rotated_at IS NULL"
                    + " AND revoked_at IS NULL",
                Integer.class,
                family))
        .isEqualTo(1);
    // The family is free again: the same token still rotates.
    assertThat(refresh(a).status()).isEqualTo(200);
  }

  @Test
  void aSignOutWhoseFamilyIsFreedWithinItsRetriesRevokesTheFamily() throws Exception {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    UUID family = familyOf(a);

    Connection holder = holdFamilyLock(family);
    Future<Resp> request;
    try {
      request = pool.submit(() -> signOut(a));
      awaitWaiterOn(family, pidOf(holder));
      // Counted from the first attempt's wait: past its 2 s lock_timeout, so only a retry can
      // revoke, and well inside the second attempt's wait.
      Thread.sleep(2_500);
    } finally {
      release(holder);
    }

    assertThat(request.get(15, TimeUnit.SECONDS).status()).isEqualTo(204);
    assertThat(liveTokensIn(family)).isZero();
  }

  @Test
  void aSignOutWhoseFamilyStaysBusyGets503WithoutRetryAfterAndLogsTheFamily(CapturedOutput output)
      throws Exception {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    UUID family = familyOf(a);

    Connection holder = holdFamilyLock(family);
    Resp answer;
    try {
      answer = pool.submit(() -> signOut(a)).get(30, TimeUnit.SECONDS);
    } finally {
      release(holder);
    }

    assertThat(answer.status()).isEqualTo(503);
    assertThat(answer.headers().getFirst("Retry-After")).isNull();
    assertThat(answer.headers().getFirst("Set-Cookie")).contains("Max-Age=0");
    assertThat(liveTokensIn(family)).isEqualTo(1);
    assertThat(output.getAll())
        .containsPattern("ERROR.*AuthService.*" + family)
        .doesNotContain(a.substring("refresh_token=".length()));
  }

  @Test
  void aRevokedTokensSignOutTakesNoFamilyLock() throws Exception {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    assertThat(signOut(a).status()).isEqualTo(204);
    UUID family = familyOf(a);

    Connection holder = holdFamilyLock(family);
    try {
      Future<Resp> request = pool.submit(() -> signOut(a));
      int waiters = maxWaitersWhile(request, family, pidOf(holder));

      assertThat(waiters).isZero();
      assertThat(request.get(5, TimeUnit.SECONDS).status()).isEqualTo(204);
    } finally {
      release(holder);
    }
  }

  @Test
  void anExpiredUnrotatedTokensSignOutTakesNoFamilyLock() throws Exception {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    jdbc.update(
        "UPDATE refresh_token SET expires_at = now() - interval '1 second' WHERE token_hash = ?",
        hashOf(a));
    UUID family = familyOf(a);

    Connection holder = holdFamilyLock(family);
    try {
      Future<Resp> request = pool.submit(() -> signOut(a));
      int waiters = maxWaitersWhile(request, family, pidOf(holder));

      assertThat(waiters).isZero();
      assertThat(request.get(5, TimeUnit.SECONDS).status()).isEqualTo(204);
    } finally {
      release(holder);
    }
  }
}
