package com.taskflow.shared.internal;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.shared.Actor;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.Idempotent;
import com.taskflow.shared.Ids;
import com.taskflow.shared.ProblemResponseWriter;
import jakarta.persistence.EntityManager;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerExecutionChain;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.springframework.web.util.ContentCachingResponseWrapper;
import org.springframework.web.util.ServletRequestPathUtils;

/**
 * Idempotent creates (AD-18). The filter owns the transaction of an {@link Idempotent} request: the
 * record row and the effect commit together, the response is buffered and sent only after the
 * commit, and any non-2xx outcome or failure rolls both back so a retry runs again.
 */
class IdempotencyFilter extends OncePerRequestFilter {

  static final String HEADER = "Idempotency-Key";
  private static final Logger log = LoggerFactory.getLogger(IdempotencyFilter.class);
  private static final List<String> STORED_HEADERS =
      List.of(HttpHeaders.CONTENT_TYPE, HttpHeaders.LOCATION, HttpHeaders.ETAG);

  private enum Kind {
    STORED,
    PASS_THROUGH,
    DUPLICATE,
    FAILED
  }

  private record Result(Kind kind, Exception failure) {}

  private final TransactionTemplate tx;
  private final JdbcTemplate jdbc;
  private final EntityManager em;
  private final ObjectProvider<RequestMappingHandlerMapping> mapping;
  private final ProblemResponseWriter problems;
  private final ObjectMapper mapper;

  IdempotencyFilter(
      TransactionTemplate tx,
      JdbcTemplate jdbc,
      EntityManager em,
      ObjectProvider<RequestMappingHandlerMapping> mapping,
      ProblemResponseWriter problems,
      ObjectMapper mapper) {
    this.tx = tx;
    this.jdbc = jdbc;
    this.em = em;
    this.mapping = mapping;
    this.problems = problems;
    this.mapper = mapper;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws java.io.IOException, jakarta.servlet.ServletException {
    String key = request.getHeader(HEADER);
    Actor actor = CurrentActor.find().orElse(null);
    if (key == null
        || actor == null
        || !"POST".equals(request.getMethod())
        || !idempotent(request)) {
      chain.doFilter(request, response);
      return;
    }
    if (key.isBlank() || key.length() > 255) {
      problems.write(
          response, HttpStatus.BAD_REQUEST, "idempotency.invalid_key", "Invalid Idempotency-Key");
      return;
    }
    byte[] body = request.getInputStream().readAllBytes();
    String hash = hash(request, body);
    CachedBodyRequest cached = new CachedBodyRequest(request, body);
    ContentCachingResponseWrapper buffered = new ContentCachingResponseWrapper(response);
    Result result;
    try {
      result = tx.execute(status -> run(status, actor.id(), key, hash, cached, buffered, chain));
    } catch (RuntimeException e) {
      buffered.resetBuffer();
      commitFailed(response, e);
      return;
    }
    switch (result.kind()) {
      case STORED, PASS_THROUGH -> buffered.copyBodyToResponse();
      case DUPLICATE -> replay(response, actor.id(), key, hash);
      case FAILED -> {
        log.error("idempotent request failed", result.failure());
        buffered.resetBuffer();
        problems.write(
            response, HttpStatus.INTERNAL_SERVER_ERROR, "internal.error", "The request failed");
      }
    }
  }

  private Result run(
      org.springframework.transaction.TransactionStatus status,
      UUID actorId,
      String key,
      String hash,
      CachedBodyRequest request,
      ContentCachingResponseWrapper response,
      FilterChain chain) {
    jdbc.update(
        "DELETE FROM idempotency_record WHERE actor_id = ? AND key = ?"
            + " AND created_at < now() - interval '24 hours'",
        actorId,
        key);
    try {
      jdbc.update(
          "INSERT INTO idempotency_record (id, actor_id, key, request_hash) VALUES (?, ?, ?, ?)",
          Ids.newId(),
          actorId,
          key,
          hash);
    } catch (DuplicateKeyException e) {
      status.setRollbackOnly();
      return new Result(Kind.DUPLICATE, null);
    }
    try {
      chain.doFilter(request, response);
    } catch (Exception e) {
      status.setRollbackOnly();
      return new Result(Kind.FAILED, e);
    }
    int code = response.getStatus();
    if (code < 200 || code >= 300) {
      status.setRollbackOnly();
      return new Result(Kind.PASS_THROUGH, null);
    }
    em.flush();
    Map<String, String> headers = new HashMap<>();
    for (String name : STORED_HEADERS) {
      String value = response.getHeader(name);
      if (value != null) {
        headers.put(name, value);
      }
    }
    try {
      jdbc.update(
          "UPDATE idempotency_record SET status = ?, headers = CAST(? AS jsonb), body = ?"
              + " WHERE actor_id = ? AND key = ?",
          code,
          mapper.writeValueAsString(headers),
          response.getContentAsByteArray(),
          actorId,
          key);
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
    return new Result(Kind.STORED, null);
  }

  private void replay(HttpServletResponse response, UUID actorId, String key, String hash)
      throws IOException {
    List<Map<String, Object>> rows =
        jdbc.queryForList(
            "SELECT request_hash, status, headers::text AS headers, body FROM idempotency_record"
                + " WHERE actor_id = ? AND key = ?",
            actorId,
            key);
    if (rows.isEmpty() || rows.get(0).get("status") == null) {
      problems.write(
          response,
          HttpStatus.CONFLICT,
          "idempotency.in_progress",
          "A request with this Idempotency-Key is still in progress");
      return;
    }
    Map<String, Object> row = rows.get(0);
    if (!hash.equals(row.get("request_hash"))) {
      problems.write(
          response,
          HttpStatus.UNPROCESSABLE_ENTITY,
          "idempotency.key_reused",
          "This Idempotency-Key was used with a different request");
      return;
    }
    Map<String, String> headers =
        mapper.readValue(String.valueOf(row.get("headers")), new TypeReference<>() {});
    response.setStatus(((Number) row.get("status")).intValue());
    headers.forEach(response::setHeader);
    response.setHeader("Idempotent-Replayed", "true");
    byte[] body = (byte[]) row.get("body");
    if (body != null && body.length > 0) {
      response.getOutputStream().write(body);
    }
    response.flushBuffer();
  }

  private void commitFailed(HttpServletResponse response, RuntimeException e) throws IOException {
    boolean conflict = false;
    for (Throwable t = e; t != null && !conflict; t = t.getCause() == t ? null : t.getCause()) {
      conflict =
          t instanceof DataIntegrityViolationException
              || t instanceof ObjectOptimisticLockingFailureException
              || t instanceof jakarta.persistence.OptimisticLockException
              || t instanceof org.hibernate.exception.ConstraintViolationException;
    }
    if (conflict) {
      problems.write(
          response,
          HttpStatus.CONFLICT,
          "request.conflict",
          "The request conflicts with current data");
    } else {
      log.error("idempotent request could not be committed", e);
      problems.write(
          response,
          HttpStatus.INTERNAL_SERVER_ERROR,
          "internal.commit_failed",
          "The request could not be committed");
    }
  }

  private boolean idempotent(HttpServletRequest request) {
    try {
      if (!ServletRequestPathUtils.hasParsedRequestPath(request)) {
        ServletRequestPathUtils.parseAndCache(request);
      }
      HandlerExecutionChain chain = mapping.getObject().getHandler(request);
      return chain != null
          && chain.getHandler() instanceof HandlerMethod method
          && method.hasMethodAnnotation(Idempotent.class);
    } catch (Exception e) {
      log.warn("idempotency handler lookup failed: {}", e.toString());
      return false;
    }
  }

  private static String hash(HttpServletRequest request, byte[] body) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      digest.update(
          (request.getMethod()
                  + " "
                  + request.getRequestURI()
                  + "?"
                  + request.getQueryString()
                  + "\n")
              .getBytes(StandardCharsets.UTF_8));
      digest.update(body);
      return HexFormat.of().formatHex(digest.digest());
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
