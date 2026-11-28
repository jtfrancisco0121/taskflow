package com.taskflow.shared;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpHeaders;

/**
 * The body of a failed tool call: the same {@code code}, title and detail the REST endpoint puts in
 * its problem+json, plus the extras (for example {@code current} on a 409), so an agent can react
 * to a stale version the way a REST client does. A tool result has no response headers, so a REST
 * {@code Retry-After} in whole seconds (the busy answer, {@link LockContention#busy}) becomes
 * {@link #RETRY_AFTER_SECONDS} (ClickUp 14yq6g33592).
 */
public final class AgentToolError {

  /** The retry hint, in whole seconds: a tool result has no headers to carry Retry-After. */
  public static final String RETRY_AFTER_SECONDS = "retryAfterSeconds";

  private AgentToolError() {}

  public static Map<String, Object> of(TaskflowException e) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("status", e.status().value());
    body.put("title", e.status().getReasonPhrase());
    body.put("detail", e.getMessage());
    body.put("code", e.code());
    body.putAll(e.extra());
    String retryAfter = e.headers().get(HttpHeaders.RETRY_AFTER);
    if (retryAfter != null && retryAfter.matches("\\d{1,9}")) {
      body.put(RETRY_AFTER_SECONDS, Integer.parseInt(retryAfter));
    }
    return body;
  }
}
