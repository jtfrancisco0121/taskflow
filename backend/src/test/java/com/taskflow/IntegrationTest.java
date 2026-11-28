package com.taskflow;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.task.TaskReader;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * Base for Testcontainers integration tests: real HTTP against the application. Every IT extends it
 * and they share one Spring context (ClickUp 14yq6g334t6, counted by ItContextBudgetTest): the
 * {@link TaskReader} spy (real calls, reset after each test) serves the tests that hold a view
 * query mid-read, so they need no context of their own; get it with {@code @Autowired}. The server
 * listens on 127.0.0.1 only and every client calls that address (ClickUp 14yq6g334e2, guarded by
 * LoopbackServerGuardTest).
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "server.address=" + IntegrationTest.HOST)
@Import(TestcontainersConfiguration.class)
@MockitoSpyBean(types = TaskReader.class)
public abstract class IntegrationTest {

  /** The only address the test server listens on and the clients call (ClickUp 14yq6g334e2). */
  public static final String HOST = "127.0.0.1";

  @Autowired protected TestRestTemplate rest;

  @org.springframework.boot.test.web.server.LocalServerPort private int serverPort;

  /**
   * TestRestTemplate calls "localhost" by default; the server listens on {@link #HOST} only, so the
   * client calls that address too and never reaches another process on the same port.
   */
  @org.junit.jupiter.api.BeforeEach
  void callTheTestServerOnLoopback() {
    rest.setUriTemplateHandler(
        new org.springframework.web.util.DefaultUriBuilderFactory(baseUrl("http")));
  }

  /** The test server's base URL, for example {@code baseUrl("ws")} for STOMP. */
  protected String baseUrl(String scheme) {
    return scheme + "://" + HOST + ":" + serverPort;
  }

  @Autowired protected ObjectMapper mapper;
  @Autowired protected JdbcTemplate jdbc;

  @org.springframework.beans.factory.annotation.Value("${taskflow.test.mailpit-api}")
  private String mailpitApi;

  protected Mailpit mailpit() {
    return new Mailpit(mailpitApi);
  }

  public record Resp(int status, JsonNode json, HttpHeaders headers, String raw) {
    public JsonNode at(String pointer) {
      return json.at(pointer);
    }

    public String text(String pointer) {
      return json.at(pointer).asText();
    }

    public UUID uuid(String pointer) {
      return UUID.fromString(json.at(pointer).asText());
    }
  }

  public record TestUser(UUID id, String email, String token) {}

  protected Resp send(
      HttpMethod method, String path, String token, Object body, String... headerPairs) {
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.APPLICATION_JSON);
    headers.setAccept(
        java.util.List.of(MediaType.APPLICATION_JSON, MediaType.APPLICATION_PROBLEM_JSON));
    if (token != null) {
      headers.setBearerAuth(token);
    }
    for (int i = 0; i + 1 < headerPairs.length; i += 2) {
      headers.set(headerPairs[i], headerPairs[i + 1]);
    }
    String payload = null;
    try {
      payload =
          body == null ? null : body instanceof String s ? s : mapper.writeValueAsString(body);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
    ResponseEntity<String> response =
        rest.exchange(path, method, new HttpEntity<>(payload, headers), String.class);
    String raw = response.getBody();
    JsonNode json;
    try {
      json = raw == null || raw.isBlank() ? mapper.nullNode() : mapper.readTree(raw);
    } catch (Exception e) {
      json = mapper.nullNode();
    }
    return new Resp(response.getStatusCode().value(), json, response.getHeaders(), raw);
  }

  protected Resp get(String path, String token, String... headers) {
    return send(HttpMethod.GET, path, token, null, headers);
  }

  protected Resp post(String path, String token, Object body, String... headers) {
    return send(HttpMethod.POST, path, token, body, headers);
  }

  protected Resp put(String path, String token, Object body, String... headers) {
    return send(HttpMethod.PUT, path, token, body, headers);
  }

  protected Resp patch(String path, String token, Object body, String... headers) {
    return send(HttpMethod.PATCH, path, token, body, headers);
  }

  protected Resp delete(String path, String token, String... headers) {
    return send(HttpMethod.DELETE, path, token, null, headers);
  }

  /** A fresh user with a unique email, signed up through the API. */
  protected TestUser signUp(String name) {
    String email =
        name.toLowerCase() + "+" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    Resp r =
        post(
            "/api/v1/auth/signup",
            null,
            java.util.Map.of(
                "email", email, "password", "correct-horse-battery", "displayName", name));
    if (r.status() != 201) {
      throw new IllegalStateException("signup failed: " + r.status() + " " + r.raw());
    }
    return new TestUser(r.uuid("/user/id"), email, r.text("/accessToken"));
  }

  /** A workspace with one user in each role. */
  public record Ws(
      UUID id, String key, TestUser owner, TestUser admin, TestUser member, TestUser guest) {
    public TestUser by(String role) {
      return switch (role) {
        case "OWNER" -> owner;
        case "ADMIN" -> admin;
        case "MEMBER" -> member;
        case "GUEST" -> guest;
        default -> throw new IllegalArgumentException(role);
      };
    }
  }

  protected static final java.util.List<String> ROLES =
      java.util.List.of("OWNER", "ADMIN", "MEMBER", "GUEST");

  protected UUID createWorkspace(TestUser owner, String name) {
    Resp r = post("/api/v1/workspaces", owner.token(), Map.of("name", name));
    if (r.status() != 201) {
      throw new IllegalStateException("workspace failed: " + r.status() + " " + r.raw());
    }
    return r.uuid("/id");
  }

  protected void addMember(UUID workspaceId, TestUser user, String role) {
    jdbc.update(
        "INSERT INTO workspace_member (workspace_id, user_id, role) VALUES (?, ?, ?)"
            + " ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role",
        workspaceId,
        user.id(),
        role);
  }

  protected Ws workspaceWithAllRoles() {
    TestUser owner = signUp("Owner");
    TestUser admin = signUp("Admin");
    TestUser member = signUp("Member");
    TestUser guest = signUp("Guest");
    UUID id = createWorkspace(owner, "Acme Roles");
    addMember(id, admin, "ADMIN");
    addMember(id, member, "MEMBER");
    addMember(id, guest, "GUEST");
    String key = jdbc.queryForObject("SELECT key FROM workspace WHERE id = ?", String.class, id);
    return new Ws(id, key, owner, admin, member, guest);
  }

  protected UUID location(TestUser user, Map<String, Object> body) {
    Resp r = post("/api/v1/locations", user.token(), body);
    if (r.status() != 201) {
      throw new IllegalStateException("location failed: " + r.status() + " " + r.raw());
    }
    return r.uuid("/id");
  }

  protected UUID space(TestUser user, UUID workspaceId, String name) {
    return location(user, Map.of("type", "SPACE", "workspaceId", workspaceId, "name", name));
  }

  protected UUID folder(TestUser user, UUID parentId, String name) {
    return location(user, Map.of("type", "FOLDER", "parentId", parentId, "name", name));
  }

  protected UUID list(TestUser user, UUID parentId, String name) {
    return location(user, Map.of("type", "LIST", "parentId", parentId, "name", name));
  }

  protected java.util.List<UUID> treeIds(
      TestUser user, UUID workspaceId, UUID parentId, boolean archived) {
    Resp r =
        get(
            "/api/v1/workspaces/"
                + workspaceId
                + "/tree?includeArchived="
                + archived
                + (parentId == null ? "" : "&parentId=" + parentId),
            user.token());
    if (r.status() != 200) {
      throw new IllegalStateException("tree failed: " + r.status() + " " + r.raw());
    }
    java.util.List<UUID> ids = new java.util.ArrayList<>();
    r.at("/items").forEach(n -> ids.add(UUID.fromString(n.get("id").asText())));
    return ids;
  }

  protected UUID task(TestUser user, UUID listId, String title) {
    Resp r = post("/api/v1/lists/" + listId + "/tasks", user.token(), Map.of("title", title));
    if (r.status() != 201) {
      throw new IllegalStateException("task failed: " + r.status() + " " + r.raw());
    }
    return r.uuid("/id");
  }

  protected Resp patchTask(TestUser user, UUID taskId, long version, Map<String, Object> body) {
    return patch("/api/v1/tasks/" + taskId, user.token(), body, "If-Match", "\"" + version + "\"");
  }
}
