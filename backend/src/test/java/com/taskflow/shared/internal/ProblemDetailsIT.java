package com.taskflow.shared.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
class ProblemDetailsIT {

  @Autowired TestRestTemplate rest;

  @Test
  void unknownPathIsProblemJson() {
    ResponseEntity<String> response = rest.getForEntity("/api/v1/does-not-exist", String.class);

    assertThat(response.getStatusCode().value()).isEqualTo(404);
    assertThat(response.getHeaders().getContentType())
        .isNotNull()
        .matches(type -> type.isCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
  }
}
