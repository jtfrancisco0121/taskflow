package com.taskflow.shared.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.taskflow.TestcontainersConfiguration;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Import;

/**
 * The committed docs/api/openapi.json is the only contract the frontend generates from. Run with
 * -Dopenapi.update=true to rewrite it instead of failing.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
class OpenApiContractIT {

  /** Every path of the contract. Add new endpoints here, then regenerate the spec. */
  private static final java.util.List<String> EXPECTED_PATHS =
      java.util.List.of(
          "/api/v1/meta",
          "/api/v1/auth/signup",
          "/api/v1/auth/signin",
          "/api/v1/auth/refresh",
          "/api/v1/auth/signout",
          "/api/v1/me",
          "/api/v1/workspaces",
          "/api/v1/workspaces/{id}",
          "/api/v1/workspaces/{id}/members",
          "/api/v1/workspaces/{id}/members/{userId}",
          "/api/v1/workspaces/{id}/leave");

  private static final Path SPEC = Path.of("..", "docs", "api", "openapi.json");

  @Autowired TestRestTemplate rest;

  @Test
  void committedSpecMatchesGeneratedSpec() throws IOException {
    String body = rest.getForObject("/v3/api-docs", String.class);
    ObjectMapper mapper =
        new ObjectMapper()
            .enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS)
            .enable(SerializationFeature.INDENT_OUTPUT);
    JsonNode tree = mapper.readTree(body);
    String generated = mapper.writeValueAsString(sorted(mapper, tree)) + "\n";

    if (Boolean.getBoolean("openapi.update")) {
      Files.createDirectories(SPEC.getParent());
      Files.writeString(SPEC, generated, StandardCharsets.UTF_8);
    }

    assertThat(SPEC).as("committed spec").exists();
    assertThat(Files.readString(SPEC, StandardCharsets.UTF_8))
        .as("docs/api/openapi.json is stale: run ./mvnw verify -Dopenapi.update=true")
        .isEqualTo(generated);
  }

  @Test
  void specListsOnlyApiV1Paths() throws IOException {
    JsonNode tree = new ObjectMapper().readTree(rest.getForObject("/v3/api-docs", String.class));
    assertThat(tree.get("paths").fieldNames())
        .toIterable()
        .containsExactlyInAnyOrderElementsOf(EXPECTED_PATHS);
    assertThat(tree.get("servers").toString()).isEqualTo("[{\"url\":\"/\"}]");
  }

  /** Recursively sorts object keys (ORDER_MAP_ENTRIES_BY_KEYS only covers Maps). */
  private static Object sorted(ObjectMapper mapper, JsonNode node) {
    return mapper.convertValue(node, Object.class);
  }
}
