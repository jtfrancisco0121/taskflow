package com.taskflow.shared;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * A tool an AI agent can call over MCP (MCP-1..MCP-4). Each module owns the tools for its own data
 * and implements this as a bean; the one MCP endpoint in identity collects them. A tool runs as the
 * calling service account on the request thread, checks access the same way the matching REST
 * endpoint does and returns the same view objects. A failure is a {@link TaskflowException}, which
 * the endpoint turns into a tool error with the REST problem code.
 */
public interface AgentTool {

  /** The tool name clients call, in snake_case. */
  String name();

  /** What the tool does, for the model. */
  String description();

  /** A JSON Schema object describing the arguments. */
  JsonNode inputSchema();

  /** Runs the tool. The result is serialized to JSON as the tool's output. */
  Object call(JsonNode arguments);

  /** The optional argument that makes a create tool safe to retry (decision 005.11). */
  String IDEMPOTENCY_KEY = "idempotencyKey";

  /**
   * Whether the tool creates something and accepts {@link #IDEMPOTENCY_KEY}. The MCP endpoint then
   * adds the argument to the schema and runs the call through {@link IdempotentCalls}.
   */
  default boolean idempotent() {
    return false;
  }

  /** The same tool, marked as a create that accepts {@link #IDEMPOTENCY_KEY}. */
  static AgentTool withIdempotencyKey(AgentTool tool) {
    return new AgentTool() {
      @Override
      public String name() {
        return tool.name();
      }

      @Override
      public String description() {
        return tool.description();
      }

      @Override
      public JsonNode inputSchema() {
        return tool.inputSchema();
      }

      @Override
      public Object call(JsonNode arguments) {
        return tool.call(arguments);
      }

      @Override
      public boolean idempotent() {
        return true;
      }
    };
  }

  /** A tool from its parts, for modules that declare their tools as {@code @Bean} methods. */
  static AgentTool of(
      String name,
      String description,
      String inputSchema,
      java.util.function.Function<JsonNode, Object> handler) {
    JsonNode schema = schema(inputSchema);
    return new AgentTool() {
      @Override
      public String name() {
        return name;
      }

      @Override
      public String description() {
        return description;
      }

      @Override
      public JsonNode inputSchema() {
        return schema;
      }

      @Override
      public Object call(JsonNode arguments) {
        return handler.apply(arguments);
      }
    };
  }

  /** Parses a JSON Schema written as a string, for {@link #inputSchema()}. */
  static JsonNode schema(String json) {
    try {
      return new ObjectMapper().readTree(json);
    } catch (JsonProcessingException e) {
      throw new IllegalArgumentException("invalid tool schema", e);
    }
  }
}
