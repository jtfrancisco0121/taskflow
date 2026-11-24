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
          "/api/v1/locations/{id}/automations",
          "/api/v1/automations/{id}",
          "/api/v1/automations/{id}/runs",
          "/api/v1/tasks/{id}/watchers",
          "/api/v1/tasks/{id}/watch",
          "/api/v1/auth/signup",
          "/api/v1/auth/signin",
          "/api/v1/auth/refresh",
          "/api/v1/auth/signout",
          "/api/v1/me",
          "/api/v1/workspaces",
          "/api/v1/workspaces/{id}",
          "/api/v1/workspaces/{id}/members",
          "/api/v1/workspaces/{id}/members/{userId}",
          "/api/v1/workspaces/{id}/leave",
          "/api/v1/workspaces/{id}/invites",
          "/api/v1/workspaces/{id}/invites/{inviteId}",
          "/api/v1/invites/{token}",
          "/api/v1/invites/{token}/accept",
          "/api/v1/locations",
          "/api/v1/locations/{id}",
          "/api/v1/locations/{id}/move",
          "/api/v1/locations/{id}/archive",
          "/api/v1/locations/{id}/unarchive",
          "/api/v1/workspaces/{id}/tree",
          "/api/v1/locations/{id}/grants",
          "/api/v1/locations/{id}/grants/{userId}",
          "/api/v1/locations/{id}/statuses",
          "/api/v1/locations/{id}/fields",
          "/api/v1/fields/{id}",
          "/api/v1/locations/{id}/fields/{fieldId}/hidden",
          "/api/v1/lists/{id}/tasks",
          "/api/v1/tasks",
          "/api/v1/tasks/{id}",
          "/api/v1/workspaces/{id}/tasks/by-ref/{ref}",
          "/api/v1/tasks/{id}/move",
          "/api/v1/tasks/{id}/duplicate",
          "/api/v1/tasks/{id}/restore",
          "/api/v1/workspaces/{id}/trash",
          "/api/v1/tasks/{id}/dependencies",
          "/api/v1/tasks/{id}/dependencies/{dependencyId}",
          "/api/v1/tasks/{id}/checklists",
          "/api/v1/checklists/{id}",
          "/api/v1/checklists/{id}/items",
          "/api/v1/checklist-items/{id}",
          "/api/v1/tasks/{id}/comments",
          "/api/v1/comments/{id}",
          "/api/v1/tasks/{id}/activity",
          "/api/v1/locations/{id}/views",
          "/api/v1/workspaces/{id}/views",
          "/api/v1/views",
          "/api/v1/views/{id}",
          "/api/v1/views/query",
          "/api/v1/workspaces/{id}/search",
          "/api/v1/workspaces/{workspaceId}/service-accounts",
          "/api/v1/workspaces/{workspaceId}/service-accounts/{id}",
          "/api/v1/workspaces/{workspaceId}/service-accounts/{id}/disable",
          "/api/v1/workspaces/{workspaceId}/service-accounts/{id}/enable",
          "/api/v1/workspaces/{workspaceId}/service-accounts/{id}/api-keys",
          "/api/v1/workspaces/{workspaceId}/service-accounts/{id}/api-keys/{keyId}",
          "/api/v1/workspaces/{workspaceId}/service-accounts/{id}/audit",
          "/api/v1/workspaces/{workspaceId}/service-accounts/{id}/activity");

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
