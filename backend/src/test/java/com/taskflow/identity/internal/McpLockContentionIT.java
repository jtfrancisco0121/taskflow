package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.shared.Actor;
import com.taskflow.shared.AgentTool;
import com.taskflow.shared.IdempotentCalls;
import com.taskflow.shared.LockTimeout;
import io.modelcontextprotocol.spec.McpSchema;
import java.sql.Connection;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * ClickUp 14yq6g33592: lock contention raised anywhere in a tool call, outside any try block of the
 * tool, is the MCP busy error with a retry hint, never 500 internal. The tool here waits on a real
 * Postgres lock held by another connection and times out (55P03), the way a service read before its
 * own contention handling would.
 */
@DisplayName("MCP tool calls answer lock contention with the busy error")
class McpLockContentionIT extends McpTestBase {

  private static final long LOCK_KEY = 0x14_9633_592L;

  @Autowired DataSource dataSource;
  @Autowired JdbcTemplate jdbcTemplate;
  @Autowired TransactionTemplate tx;
  @Autowired ObjectMapper mapper;
  @Autowired IdempotentCalls idempotentCalls;

  @AfterEach
  void clearActor() {
    SecurityContextHolder.clearContext();
  }

  /** A tool with no contention handling of its own: it takes a lock another session holds. */
  private AgentTool waitsOnTheLock() {
    return AgentTool.of(
        "probe_lock",
        "test only",
        "{\"type\":\"object\"}",
        arguments ->
            tx.execute(status -> {
              LockTimeout.set(jdbcTemplate, Duration.ofMillis(200));
              jdbcTemplate.query("SELECT pg_advisory_xact_lock(?)", rs -> {}, LOCK_KEY);
              return Map.of("ok", true);
            }));
  }

  private JsonNode callWhileLocked(AgentTool tool, Map<String, Object> arguments) throws Exception {
    try (Connection holder = dataSource.getConnection()) {
      try (var st = holder.prepareStatement("SELECT pg_advisory_lock(?)")) {
        st.setLong(1, LOCK_KEY);
        st.executeQuery();
      }
      try {
        McpSchema.CallToolResult result =
            McpServerConfig.call(
                tool,
                new McpSchema.CallToolRequest(tool.name(), arguments),
                mapper,
                idempotentCalls);
        assertThat(result.isError()).isTrue();
        return mapper.readTree(((McpSchema.TextContent) result.content().get(0)).text());
      } finally {
        try (var st = holder.prepareStatement("SELECT pg_advisory_unlock(?)")) {
          st.setLong(1, LOCK_KEY);
          st.executeQuery();
        }
      }
    }
  }

  @Test
  void contentionOutsideTheToolsTryBlockIsBusyWithARetryHint() throws Exception {
    JsonNode body = callWhileLocked(waitsOnTheLock(), Map.of());

    assertThat(body.get("status").asInt()).isEqualTo(503);
    assertThat(body.get("code").asText()).isEqualTo("request.busy");
    assertThat(body.get("retryAfterSeconds").asInt()).isEqualTo(1);
  }

  @Test
  void contentionInAnIdempotentCallIsBusyAndStoresNoIdempotencyRecord() throws Exception {
    UUID actor = signUp("mcp-busy").id();
    SecurityContextHolder.getContext()
        .setAuthentication(
            UsernamePasswordAuthenticationToken.authenticated(Actor.user(actor), null, List.of()));
    String key = "busy-" + UUID.randomUUID();

    JsonNode body =
        callWhileLocked(
            AgentTool.withIdempotencyKey(waitsOnTheLock()), Map.of("idempotencyKey", key));

    assertThat(body.get("code").asText()).isEqualTo("request.busy");
    assertThat(body.get("retryAfterSeconds").asInt()).isEqualTo(1);
    assertThat(
            jdbcTemplate.queryForObject(
                "SELECT count(*) FROM idempotency_record WHERE key = ?", Integer.class, key))
        .isZero();
  }

  @Test
  void anyOtherFailureIsStillInternalWithoutARetryHint() throws Exception {
    AgentTool broken =
        AgentTool.of(
            "probe_broken",
            "test only",
            "{\"type\":\"object\"}",
            arguments -> {
              throw new IllegalStateException("boom");
            });

    JsonNode body = callWhileLocked(broken, Map.of());

    assertThat(body.get("status").asInt()).isEqualTo(500);
    assertThat(body.get("code").asText()).isEqualTo("internal");
    assertThat(body.has("retryAfterSeconds")).isFalse();
  }
}
