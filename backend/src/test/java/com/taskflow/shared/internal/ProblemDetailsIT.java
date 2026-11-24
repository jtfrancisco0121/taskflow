package com.taskflow.shared.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import org.junit.jupiter.api.Test;
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
}
