package com.taskflow.shared;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;

/** A domain failure rendered as problem+json with a dotted {@code code} extension. */
public class TaskflowException extends RuntimeException {

  private final HttpStatus status;
  private final String code;
  private final Map<String, Object> extra = new LinkedHashMap<>();
  private final Map<String, String> headers = new LinkedHashMap<>();

  public TaskflowException(HttpStatus status, String code, String message) {
    super(message);
    this.status = status;
    this.code = code;
  }

  public static TaskflowException notFound(String code, String message) {
    return new TaskflowException(HttpStatus.NOT_FOUND, code, message);
  }

  public static TaskflowException forbidden(String code, String message) {
    return new TaskflowException(HttpStatus.FORBIDDEN, code, message);
  }

  public static TaskflowException conflict(String code, String message) {
    return new TaskflowException(HttpStatus.CONFLICT, code, message);
  }

  public static TaskflowException badRequest(String code, String message) {
    return new TaskflowException(HttpStatus.BAD_REQUEST, code, message);
  }

  public TaskflowException with(String key, Object value) {
    extra.put(key, value);
    return this;
  }

  /** Adds a response header, for example Retry-After. */
  public TaskflowException header(String name, String value) {
    headers.put(name, value);
    return this;
  }

  public Map<String, String> headers() {
    return headers;
  }

  public HttpStatus status() {
    return status;
  }

  public String code() {
    return code;
  }

  public Map<String, Object> extra() {
    return extra;
  }
}
