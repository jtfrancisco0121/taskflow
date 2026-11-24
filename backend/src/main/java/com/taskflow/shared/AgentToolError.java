package com.taskflow.shared;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The body of a failed tool call: the same {@code code}, title and detail the REST endpoint puts in
 * its problem+json, plus the extras (for example {@code current} on a 409), so an agent can react
 * to a stale version the way a REST client does.
 */
public final class AgentToolError {

  private AgentToolError() {}

  public static Map<String, Object> of(TaskflowException e) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("status", e.status().value());
    body.put("title", e.status().getReasonPhrase());
    body.put("detail", e.getMessage());
    body.put("code", e.code());
    body.putAll(e.extra());
    return body;
  }
}
