package com.taskflow.shared.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;

class ProblemDetailsIT extends IntegrationTest {

  @Test
  void unknownPathIsProblemJson() {
    Resp response = get("/api/v1/does-not-exist", signUp("Problem").token());

    assertThat(response.status()).isEqualTo(404);
    assertThat(response.headers().getContentType())
        .isNotNull()
        .matches(type -> type.isCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    assertThat(response.text("/code")).isEqualTo("request.404");
  }

  @Test
  void unauthenticatedApiRequestIsProblemJson401() {
    Resp response = get("/api/v1/does-not-exist", null);

    assertThat(response.status()).isEqualTo(401);
    assertThat(response.headers().getContentType())
        .isNotNull()
        .matches(type -> type.isCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
  }

  /**
   * ClickUp 14yq6g334r6 items 1 and 5: deadlock (40P01), serialization failure (40001) and lock
   * timeout (55P03) are retryable contention, so 503 with Retry-After instead of a 500.
   */
  @ParameterizedTest
  @ValueSource(strings = {"40P01", "40001", "55P03"})
  void lockContentionIs503WithRetryAfter(String sqlState) {
    Resp response =
        post(
            "/api/v1/test/sqlstate/" + sqlState,
            null,
            null,
            "X-Test-User",
            UUID.randomUUID().toString());

    assertThat(response.status()).isEqualTo(503);
    assertThat(response.headers().getFirst("Retry-After")).isEqualTo("1");
    assertThat(response.headers().getContentType())
        .isNotNull()
        .matches(type -> type.isCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    assertThat(response.text("/code")).isEqualTo("request.busy");
  }

  @Test
  void anUncategorizedSqlErrorIsStillA500() {
    Resp response =
        post(
            "/api/v1/test/sqlstate/XX000", null, null, "X-Test-User", UUID.randomUUID().toString());

    assertThat(response.status()).isEqualTo(500);
    assertThat(response.headers().getFirst("Retry-After")).isNull();
  }
}
