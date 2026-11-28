package com.taskflow.shared.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.taskflow.IntegrationTest;
import com.taskflow.shared.AppMeta;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

class MetaControllerIT extends IntegrationTest {

  @Test
  void returnsNameAndVersion() {
    ResponseEntity<AppMeta> response = rest.getForEntity("/api/v1/meta", AppMeta.class);

    assertThat(response.getStatusCode().value()).isEqualTo(200);
    assertThat(response.getBody()).isNotNull();
    assertThat(response.getBody().name()).isEqualTo("taskflow");
    assertThat(response.getBody().version()).isNotBlank();
  }
}
