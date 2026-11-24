package com.taskflow.shared.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import com.taskflow.IntegrationTest.TestUser;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

@DisplayName("CAP-25 idempotent creates")
class IdempotencyIT extends IntegrationTest {

  private static final String BASE = "/api/v1/test/idem";

  private final String user = UUID.randomUUID().toString();

  private Resp create(String path, String key, String name, String kind) {
    return post(
        BASE + path,
        null,
        Map.of("name", name, "kind", kind),
        "X-Test-User",
        user,
        "Idempotency-Key",
        key);
  }

  private int effects(String name) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM idem_effect WHERE name = ?", Integer.class, name);
  }

  private int records(String key) {
    return jdbc.queryForObject(
        "SELECT count(*) FROM idempotency_record WHERE key = ?", Integer.class, key);
  }

  private static String unique() {
    return UUID.randomUUID().toString();
  }

  @Test
  void sameKeyAndBodyReplayTheFirstResponse() {
    String key = unique();
    String name = unique();
    Resp first = create("/create", key, name, "ok");
    Resp second = create("/create", key, name, "ok");
    assertThat(first.status()).isEqualTo(201);
    assertThat(second.status()).isEqualTo(201);
    assertThat(second.raw()).isEqualTo(first.raw());
    assertThat(second.headers().getFirst("Location"))
        .isEqualTo(first.headers().getFirst("Location"));
    assertThat(second.headers().getFirst("Idempotent-Replayed")).isEqualTo("true");
    assertThat(effects(name)).isEqualTo(1);
  }

  @Test
  void sameKeyWithADifferentBodyIs422ProblemJson() {
    String key = unique();
    create("/create", key, unique(), "ok");
    Resp other = create("/create", key, unique(), "ok");
    assertThat(other.status()).isEqualTo(422);
    assertThat(
            other.headers().getContentType().isCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .isTrue();
    assertThat(other.text("/code")).isEqualTo("idempotency.key_reused");
  }

  @Test
  void theSameKeyOnAnotherPathIsNotAReplay() {
    String key = unique();
    String name = unique();
    assertThat(create("/create", key, name, "ok").status()).isEqualTo(201);
    Resp other = create("/commit", key, name, "ok");
    assertThat(other.status()).isEqualTo(422);
    assertThat(effects(name)).isEqualTo(1);
  }

  @Test
  void aFailedCreateLeavesNoRecordAndTheRetryWithTheSameKeySucceeds() {
    String key = unique();
    String name = unique();
    Resp failed = create("/create", key, name, "invalid");
    assertThat(failed.status()).isEqualTo(400);
    assertThat(failed.text("/code")).isEqualTo("probe.invalid");
    assertThat(effects(name)).isZero();
    assertThat(records(key)).isZero();

    Resp retry = create("/create", key, name, "ok");
    assertThat(retry.status()).isEqualTo(201);
    assertThat(effects(name)).isEqualTo(1);
    assertThat(records(key)).isEqualTo(1);
  }

  @Test
  void aServiceThatThrowsInsideTheJoinedTransactionGivesItsOwn4xx() {
    String key = unique();
    String name = unique();
    Resp failed = create("/service", key, name, "fail");
    assertThat(failed.status()).isEqualTo(409);
    assertThat(failed.text("/code")).isEqualTo("probe.failed");
    assertThat(effects(name)).isZero();
    assertThat(records(key)).isZero();
    assertThat(create("/service", key, name, "ok").status()).isEqualTo(201);
    assertThat(effects(name)).isEqualTo(1);
  }

  @Test
  void parallelDuplicatesProduceExactlyOneEffect() throws Exception {
    String key = unique();
    String name = unique();
    ProbeController.arm();
    CompletableFuture<Resp> a =
        CompletableFuture.supplyAsync(() -> create("/slow", key, name, "ok"));
    assertThat(ProbeController.GATE[0].await(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
    CompletableFuture<Resp> b =
        CompletableFuture.supplyAsync(() -> create("/slow", key, name, "ok"));
    Thread.sleep(500);
    ProbeController.GATE[1].countDown();
    Resp first = a.get();
    Resp second = b.get();
    ProbeController.GATE[0] = null;

    assertThat(first.status()).isEqualTo(201);
    assertThat(second.status()).isIn(201, 409);
    if (second.status() == 201) {
      assertThat(second.raw()).isEqualTo(first.raw());
    }
    assertThat(effects(name)).isEqualTo(1);
    assertThat(records(key)).isEqualTo(1);
  }

  @Test
  void aUniqueViolationAtFlushGives409ProblemAndLeavesNothing() {
    String key = unique();
    String name = unique();
    Resp failed = create("/flush", key, name, "unique");
    assertThat(failed.status()).isEqualTo(409);
    assertThat(
            failed.headers().getContentType().isCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .isTrue();
    assertThat(failed.text("/code")).isNotBlank();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM idem_probe WHERE name = ?", Integer.class, name))
        .isZero();
    assertThat(records(key)).isZero();

    Resp retry = create("/flush", key, name, "ok");
    assertThat(retry.status()).isEqualTo(201);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM idem_probe WHERE name = ?", Integer.class, name))
        .isEqualTo(1);
  }

  @Test
  void aForeignKeyViolationAtFlushGives409ProblemAndLeavesNothing() {
    String key = unique();
    String name = unique();
    Resp failed = create("/flush", key, name, "fk");
    assertThat(failed.status()).isEqualTo(409);
    assertThat(
            failed.headers().getContentType().isCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .isTrue();
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM idem_probe WHERE name = ?", Integer.class, name))
        .isZero();
    assertThat(records(key)).isZero();
    assertThat(create("/flush", key, name, "ok").status()).isEqualTo(201);
  }

  @Test
  void aFailureAtCommitGives500ProblemAndLeavesNothing() {
    String key = unique();
    String name = unique();
    Resp failed = create("/commit", key, name, "fail");
    assertThat(failed.status()).isEqualTo(500);
    assertThat(
            failed.headers().getContentType().isCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .isTrue();
    assertThat(failed.text("/code")).isEqualTo("internal.commit_failed");
    assertThat(effects(name)).isZero();
    assertThat(records(key)).isZero();

    assertThat(create("/commit", key, name, "ok").status()).isEqualTo(201);
    assertThat(effects(name)).isEqualTo(1);
  }

  @Test
  void requestsWithoutAKeyOrWithoutTheAnnotationRunAsBefore() {
    String name = unique();
    assertThat(
            post(BASE + "/create", null, Map.of("name", name, "kind", "ok"), "X-Test-User", user)
                .status())
        .isEqualTo(201);
    assertThat(
            post(BASE + "/create", null, Map.of("name", name, "kind", "ok"), "X-Test-User", user)
                .status())
        .isEqualTo(201);
    assertThat(effects(name)).isEqualTo(2);

    String key = unique();
    String plain = unique();
    create("/plain", key, plain, "ok");
    create("/plain", key, plain, "ok");
    assertThat(effects(plain)).isEqualTo(2);
    assertThat(records(key)).isZero();
  }

  @Test
  void aRequestWithoutAnActorIsRefused() {
    Resp r =
        post(
            BASE + "/create",
            null,
            Map.of("name", unique(), "kind", "ok"),
            "Idempotency-Key",
            unique());
    assertThat(r.status()).isEqualTo(401);
  }

  @Test
  void realCreateEndpointsHonourTheKeyForWorkspacesAndTasks() throws Exception {
    TestUser owner = signUp("Idem");
    String key = unique();
    Resp first =
        post("/api/v1/workspaces", owner.token(), Map.of("name", "Keyed"), "Idempotency-Key", key);
    Resp replay =
        post("/api/v1/workspaces", owner.token(), Map.of("name", "Keyed"), "Idempotency-Key", key);
    Resp different =
        post("/api/v1/workspaces", owner.token(), Map.of("name", "Other"), "Idempotency-Key", key);
    assertThat(first.status()).isEqualTo(201);
    assertThat(replay.raw()).isEqualTo(first.raw());
    assertThat(different.status()).isEqualTo(422);
    assertThat(
            jdbc.queryForObject(
                "SELECT count(*) FROM workspace WHERE name = 'Keyed'", Integer.class))
        .isEqualTo(1);

    UUID space = space(owner, first.uuid("/id"), "S");
    UUID list = list(owner, space, "L");
    String taskKey = unique();
    CompletableFuture<Resp> a =
        CompletableFuture.supplyAsync(() ->
            post(
                "/api/v1/lists/" + list + "/tasks",
                owner.token(),
                Map.of("title", "Once"),
                "Idempotency-Key",
                taskKey));
    CompletableFuture<Resp> b =
        CompletableFuture.supplyAsync(() ->
            post(
                "/api/v1/lists/" + list + "/tasks",
                owner.token(),
                Map.of("title", "Once"),
                "Idempotency-Key",
                taskKey));
    Resp ra = a.get();
    Resp rb = b.get();
    assertThat(java.util.List.of(ra.status(), rb.status())).allMatch(s -> s == 201 || s == 409);
    assertThat(
            jdbc.queryForObject("SELECT count(*) FROM task WHERE list_id = ?", Integer.class, list))
        .isEqualTo(1);

    String failKey = unique();
    UUID missing = UUID.randomUUID();
    assertThat(
            post(
                    "/api/v1/lists/" + missing + "/tasks",
                    owner.token(),
                    Map.of("title", "x"),
                    "Idempotency-Key",
                    failKey)
                .status())
        .isEqualTo(404);
    assertThat(records(failKey)).isZero();
  }
}
