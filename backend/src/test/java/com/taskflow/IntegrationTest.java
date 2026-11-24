package com.taskflow;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

/** Base for Testcontainers integration tests: real HTTP against the application. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
public abstract class IntegrationTest {

  @Autowired protected TestRestTemplate rest;
  @Autowired protected ObjectMapper mapper;
  @Autowired protected JdbcTemplate jdbc;

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
}
