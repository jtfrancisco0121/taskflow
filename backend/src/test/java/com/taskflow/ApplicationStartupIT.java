package com.taskflow;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Import;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
class ApplicationStartupIT {

  @Autowired TestRestTemplate rest;
  @Autowired JdbcTemplate jdbc;

  @Test
  void healthEndpointIsUp() {
    ResponseEntity<String> response = rest.getForEntity("/actuator/health", String.class);
    assertThat(response.getStatusCode().value()).isEqualTo(200);
    assertThat(response.getBody()).contains("\"status\":\"UP\"");
  }

  @Test
  void flywayAppliedOneSuccessfulMigration() {
    Integer count =
        jdbc.queryForObject(
            "SELECT count(*) FROM flyway_schema_history WHERE success", Integer.class);
    assertThat(count).isEqualTo(1);
  }

  @Test
  void ltreeExtensionIsInstalled() {
    List<String> extensions = jdbc.queryForList("SELECT extname FROM pg_extension", String.class);
    assertThat(extensions).contains("ltree");
  }
}
