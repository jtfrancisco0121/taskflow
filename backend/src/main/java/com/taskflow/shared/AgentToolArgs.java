package com.taskflow.shared;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/** Reads tool arguments. A bad or missing one is a 400 {@code tool.invalid_argument}. */
public final class AgentToolArgs {

  private AgentToolArgs() {}

  public static UUID uuid(JsonNode args, String field) {
    UUID id = optUuid(args, field);
    if (id == null) {
      throw invalid(field + " is required");
    }
    return id;
  }

  public static UUID optUuid(JsonNode args, String field) {
    JsonNode v = args == null ? null : args.get(field);
    if (v == null || v.isNull()) {
      return null;
    }
    try {
      return UUID.fromString(v.asText());
    } catch (IllegalArgumentException e) {
      throw invalid(field + " must be a UUID");
    }
  }

  /** A required, non-blank string. */
  public static String text(JsonNode args, String field) {
    String v = optText(args, field);
    if (v == null || v.isBlank()) {
      throw invalid(field + " is required");
    }
    return v;
  }

  public static String optText(JsonNode args, String field) {
    JsonNode v = args == null ? null : args.get(field);
    if (v == null || v.isNull()) {
      return null;
    }
    if (!v.isTextual()) {
      throw invalid(field + " must be a string");
    }
    return v.asText();
  }

  public static Long optLong(JsonNode args, String field) {
    JsonNode v = args == null ? null : args.get(field);
    if (v == null || v.isNull()) {
      return null;
    }
    if (!v.canConvertToLong() || !v.isIntegralNumber()) {
      throw invalid(field + " must be an integer");
    }
    return v.asLong();
  }

  public static Integer optInt(JsonNode args, String field) {
    Long v = optLong(args, field);
    return v == null ? null : (int) Math.max(Integer.MIN_VALUE, Math.min(Integer.MAX_VALUE, v));
  }

  public static boolean optBoolean(JsonNode args, String field) {
    JsonNode v = args == null ? null : args.get(field);
    return v != null && v.asBoolean(false);
  }

  public static TaskflowException invalid(String message) {
    return TaskflowException.badRequest("tool.invalid_argument", message);
  }
}
