package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

/** Decision 010: {@code refresh-reuse-grace: PT0S} restores strict reuse detection exactly. */
@DisplayName("AUTH-2 refresh reuse grace switched off")
@TestPropertySource(properties = "taskflow.jwt.refresh-reuse-grace=PT0S")
class RefreshGraceDisabledIT extends IntegrationTest {

  private Resp signup() {
    return post(
        "/api/v1/auth/signup",
        null,
        Map.of("email", AuthIT.email(), "password", AuthIT.PASSWORD, "displayName", "Strict"));
  }

  private Resp refresh(String cookie) {
    return post("/api/v1/auth/refresh", null, null, "Cookie", cookie);
  }

  private int liveTokens(Resp up) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM refresh_token r JOIN app_user u ON u.id = r.user_id WHERE u.email = ?"
            + " AND r.revoked_at IS NULL",
        Integer.class,
        up.text("/user/email"));
  }

  @Test
  void replayingTheJustRotatedTokenRevokesTheFamily() {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    Resp toB = refresh(a);
    assertThat(toB.status()).isEqualTo(200);
    String b = AuthIT.refreshCookie(toB);

    Resp replay = refresh(a);

    assertThat(replay.status()).isEqualTo(401);
    assertThat(replay.text("/code")).isEqualTo("auth.invalid_refresh");
    assertThat(refresh(b).status()).isEqualTo(401);
    assertThat(liveTokens(up)).isZero();
  }

  @Test
  void twoConcurrentRefreshesWithOneTokenLeaveOneWinnerAndRevokeTheFamily() throws Exception {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);
    CountDownLatch start = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      List<Future<Resp>> calls =
          List.of(
              pool.submit(() -> {
                start.await();
                return refresh(a);
              }),
              pool.submit(() -> {
                start.await();
                return refresh(a);
              }));
      start.countDown();
      List<Integer> statuses =
          List.of(
              calls.get(0).get(30, TimeUnit.SECONDS).status(),
              calls.get(1).get(30, TimeUnit.SECONDS).status());

      assertThat(statuses).containsExactlyInAnyOrder(200, 401);
      assertThat(liveTokens(up)).isZero();
    } finally {
      pool.shutdownNow();
    }
  }
}
