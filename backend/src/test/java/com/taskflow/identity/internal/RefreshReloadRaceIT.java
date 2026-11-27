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

/**
 * ClickUp 14yq6g334jy: a page reload aborts POST /auth/refresh after the server rotated the token,
 * so the browser keeps the old cookie and presents it again on the next boot. Today the server
 * reads that as theft and revokes the whole family (AuthService.refresh), signing the user out.
 * These tests describe the behaviour the fix must give; they fail until it lands.
 */
@DisplayName("AUTH-2 refresh survives a lost rotation response")
class RefreshReloadRaceIT extends IntegrationTest {

  private static final String REFRESH = "/api/v1/auth/refresh";

  private Resp signup() {
    return post(
        "/api/v1/auth/signup",
        null,
        Map.of("email", AuthIT.email(), "password", AuthIT.PASSWORD, "displayName", "Reload"));
  }

  private Resp refresh(String cookie) {
    return post(REFRESH, null, null, "Cookie", cookie);
  }

  @Test
  void replayingTheJustRotatedTokenWhoseSuccessorWasNeverDeliveredKeepsTheSession() {
    Resp up = signup();
    String a = AuthIT.refreshCookie(up);

    // The server rotates A to B, but the reload aborts the request: the browser never sees B.
    Resp lost = refresh(a);
    assertThat(lost.status()).isEqualTo(200);

    // The reloaded page boots with the cookie it still has: A.
    Resp boot = refresh(a);

    assertThat(boot.status()).as("boot refresh with the cookie the browser kept").isEqualTo(200);
    assertThat(get("/api/v1/me", boot.text("/accessToken")).status()).isEqualTo(200);
    Resp next = refresh(AuthIT.refreshCookie(boot));
    assertThat(next.status()).as("the session keeps rotating afterwards").isEqualTo(200);
  }

  @Test
  void twoConcurrentRefreshesWithOneTokenBothSucceedAndEitherCookieKeepsWorking() throws Exception {
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
      Resp first = calls.get(0).get(30, TimeUnit.SECONDS);
      Resp second = calls.get(1).get(30, TimeUnit.SECONDS);

      assertThat(List.of(first.status(), second.status())).containsExactly(200, 200);
      // The browser's cookie jar keeps whichever Set-Cookie it processed last, so each answer's
      // cookie must still carry the session.
      assertThat(refresh(AuthIT.refreshCookie(first)).status()).isEqualTo(200);
      assertThat(refresh(AuthIT.refreshCookie(second)).status()).isEqualTo(200);
    } finally {
      pool.shutdownNow();
    }
  }
}
