package com.taskflow.shared.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.TestcontainersConfiguration;
import com.taskflow.shared.AppMeta;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Import;
import org.springframework.http.ResponseEntity;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
class MetaControllerIT {

  @Autowired TestRestTemplate rest;

  @Test
  void returnsNameAndVersion() {
    ResponseEntity<AppMeta> response = rest.getForEntity("/api/v1/meta", AppMeta.class);

    assertThat(response.getStatusCode().value()).isEqualTo(200);
    assertThat(response.getBody()).isNotNull();
    assertThat(response.getBody().name()).isEqualTo("taskflow");
    assertThat(response.getBody().version()).isNotBlank();
  }
}
