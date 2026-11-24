package com.taskflow.identity.internal;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;

/** Calls the MCP endpoint over plain HTTP JSON-RPC, as any MCP client does. */
public abstract class McpTestBase extends ServiceAccountTestBase {

  public static final String MCP = "/api/v1/mcp";

  /** The outcome of tools/call: the parsed JSON text of the first content item. */
  public record ToolResult(boolean isError, JsonNode body, Resp raw) {}

  protected Resp rpc(String key, String method, Object params) {
    Map<String, Object> message = new java.util.LinkedHashMap<>();
    message.put("jsonrpc", "2.0");
    message.put("id", 1);
    message.put("method", method);
    if (params != null) {
      message.put("params", params);
    }
    return post(MCP, key, message, "Accept", "application/json, text/event-stream");
  }

  protected ToolResult call(String key, String tool, Map<String, Object> arguments) {
    Resp r = rpc(key, "tools/call", Map.of("name", tool, "arguments", arguments));
    if (r.status() != 200 || r.json().has("error")) {
      throw new IllegalStateException("tools/call failed: " + r.status() + " " + r.raw());
    }
    JsonNode result = r.at("/result");
    String text = result.at("/content/0/text").asText();
    try {
      return new ToolResult(result.path("isError").asBoolean(false), mapper.readTree(text), r);
    } catch (Exception e) {
      throw new IllegalStateException("tool output is not JSON: " + text, e);
    }
  }
}
