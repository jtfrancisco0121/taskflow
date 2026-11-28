package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * ClickUp 14yq6g334jy, review round 1: refresh and sign-out on one token family must not deadlock
 * each other (40P01 surfaced as a 500) and sign-out must leave the family with no live token, so
 * every request on a family is serialised before it takes any token row lock (decision 010).
 */
@DisplayName("AUTH-2 concurrent refresh and sign-out on one family")
class RefreshFamilyLockIT extends IntegrationTest {

  private static final int ITERATIONS = 50;
  private static final String REFRESH = "/api/v1/auth/refresh";
  private static final String SIGNOUT = "/api/v1/auth/signout";

  private ExecutorService pool;

  @BeforeEach
  void startPool() {
    pool = Executors.newFixedThreadPool(2);
  }

  @AfterEach
  void stopPool() {
    pool.shutdownNow();
  }

  private Resp signup() {
    return post(
        "/api/v1/auth/signup",
        null,
        Map.of("email", AuthIT.email(), "password", AuthIT.PASSWORD, "displayName", "Lock"));
  }

  private Resp refresh(String cookie) {
    return post(REFRESH, null, null, "Cookie", cookie);
  }

  private Resp signOut(String cookie) {
    return post(SIGNOUT, null, null, "Cookie", cookie);
  }

  private int unrevokedTokens(Resp up) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM refresh_token r JOIN app_user u ON u.id = r.user_id WHERE u.email = ?"
            + " AND r.revoked_at IS NULL",
        Integer.class,
        up.text("/user/email"));
  }

  /** Runs both calls released together by a barrier and returns their answers in order. */
  private List<Resp> together(Callable<Resp> first, Callable<Resp> second) throws Exception {
    CyclicBarrier barrier = new CyclicBarrier(2);
    Future<Resp> a =
        pool.submit(() -> {
          barrier.await(10, TimeUnit.SECONDS);
          return first.call();
        });
    Future<Resp> b =
        pool.submit(() -> {
          barrier.await(10, TimeUnit.SECONDS);
          return second.call();
        });
    return List.of(a.get(30, TimeUnit.SECONDS), b.get(30, TimeUnit.SECONDS));
  }

  @Test
  void twoStaleTokensOfOneFamilyRefreshedTogetherNeverFailWithA5xxAndRevokeTheFamily()
      throws Exception {
    List<String> problems = new ArrayList<>();
    for (int i = 0; i < ITERATIONS; i++) {
      Resp up = signup();
      String a = AuthIT.refreshCookie(up);
      Resp toB = refresh(a);
      String b = AuthIT.refreshCookie(toB);
      Resp toC = refresh(b);
      assertThat(List.of(toB.status(), toC.status())).containsExactly(200, 200);

      // A's successor B was used, so A is reuse; B is the grace replay of C.
      List<Resp> answers = together(() -> refresh(a), () -> refresh(b));

      for (Resp r : answers) {
        if (!Set.of(200, 401).contains(r.status())) {
          problems.add("iteration " + i + ": status " + r.status() + " " + r.raw());
        }
      }
      if (unrevokedTokens(up) != 0) {
        problems.add("iteration " + i + ": " + unrevokedTokens(up) + " unrevoked tokens");
      }
    }
    assertThat(problems).isEmpty();
  }

  @Test
  void signOutRacingAGraceReplayAlwaysSignsOutAndLeavesNoLiveToken() throws Exception {
    List<String> problems = new ArrayList<>();
    for (int i = 0; i < ITERATIONS; i++) {
      Resp up = signup();
      String a = AuthIT.refreshCookie(up);
      // The rotation to B was lost by a reload: the browser still holds A.
      assertThat(refresh(a).status()).isEqualTo(200);

      List<Resp> answers = together(() -> signOut(a), () -> refresh(a));

      if (answers.get(0).status() != 204) {
        problems.add("iteration " + i + ": sign-out " + answers.get(0).status());
      }
      if (!Set.of(200, 401).contains(answers.get(1).status())) {
        problems.add("iteration " + i + ": refresh " + answers.get(1).status());
      }
      if (unrevokedTokens(up) != 0) {
        problems.add("iteration " + i + ": " + unrevokedTokens(up) + " unrevoked tokens");
      }
    }
    assertThat(problems).isEmpty();
  }

  @Test
  void signOutRacingTheRotationLeavesNoUnrevokedSuccessor() throws Exception {
    List<String> problems = new ArrayList<>();
    for (int i = 0; i < ITERATIONS; i++) {
      Resp up = signup();
      String a = AuthIT.refreshCookie(up);

      List<Resp> answers = together(() -> signOut(a), () -> refresh(a));

      if (answers.get(0).status() != 204) {
        problems.add("iteration " + i + ": sign-out " + answers.get(0).status());
      }
      if (!Set.of(200, 401).contains(answers.get(1).status())) {
        problems.add("iteration " + i + ": refresh " + answers.get(1).status());
      }
      if (unrevokedTokens(up) != 0) {
        problems.add("iteration " + i + ": " + unrevokedTokens(up) + " unrevoked tokens");
      }
    }
    assertThat(problems).isEmpty();
  }
}
