package com.taskflow.shared;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Idempotent calls that do not go through the HTTP filter: the MCP create tools (decision 005.11).
 * Same {@code idempotency_record} rows and rules as {@code IdempotencyFilter} (AD-18): the record
 * and the effect commit together, only a success is stored, the same key with the same request
 * returns the stored result, the same key with a different request is refused, a concurrent second
 * call waits on the unique key and then replays, and records expire after 24 hours. Keys are scoped
 * per actor, so per service account for MCP.
 */
@Component
public class IdempotentCalls {

  public static final int MAX_KEY_LENGTH = 255;

  private record Outcome(boolean duplicate, JsonNode result) {}

  private final TransactionTemplate tx;
  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;

  IdempotentCalls(TransactionTemplate tx, JdbcTemplate jdbc, ObjectMapper mapper) {
    this.tx = tx;
    this.jdbc = jdbc;
    this.mapper = mapper;
  }

  /**
   * Runs {@code action} once for this actor and key. {@code requestHash} identifies the request, so
   * a reused key with a different request fails with {@code idempotency.key_reused}.
   */
  public JsonNode run(UUID actorId, String key, String requestHash, Supplier<JsonNode> action) {
    if (key == null || key.isBlank() || key.length() > MAX_KEY_LENGTH) {
      throw TaskflowException.badRequest("idempotency.invalid_key", "Invalid idempotency key");
    }
    Outcome outcome =
        tx.execute(status -> {
          jdbc.update(
              "DELETE FROM idempotency_record WHERE actor_id = ? AND key = ?"
                  + " AND created_at < now() - interval '24 hours'",
              actorId,
              key);
          try {
            jdbc.update(
                "INSERT INTO idempotency_record (id, actor_id, key, request_hash)"
                    + " VALUES (?, ?, ?, ?)",
                Ids.newId(),
                actorId,
                key,
                requestHash);
          } catch (DuplicateKeyException e) {
            status.setRollbackOnly();
            return new Outcome(true, null);
          }
          JsonNode result = action.get();
          try {
            jdbc.update(
                "UPDATE idempotency_record SET status = 200, headers = '{}'::jsonb, body = ?"
                    + " WHERE actor_id = ? AND key = ?",
                mapper.writeValueAsBytes(result),
                actorId,
                key);
          } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException(e);
          }
          return new Outcome(false, result);
        });
    return outcome.duplicate() ? replay(actorId, key, requestHash) : outcome.result();
  }

  private JsonNode replay(UUID actorId, String key, String requestHash) {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT request_hash, status, body FROM idempotency_record"
                + " WHERE actor_id = ? AND key = ?",
            actorId,
            key);
    if (rows.isEmpty() || rows.get(0).get("status") == null) {
      throw TaskflowException.conflict(
          "idempotency.in_progress", "A request with this idempotency key is still in progress");
    }
    Map<String, Object> row = rows.get(0);
    if (!requestHash.equals(row.get("request_hash"))) {
      throw new TaskflowException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          "idempotency.key_reused",
          "This idempotency key was used with a different request");
    }
    try {
      return mapper.readTree((byte[]) row.get("body"));
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
  }
}
