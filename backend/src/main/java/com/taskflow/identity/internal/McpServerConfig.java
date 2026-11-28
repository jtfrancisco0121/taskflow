package com.taskflow.identity.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.taskflow.shared.Actor;
import com.taskflow.shared.ActorType;
import com.taskflow.shared.AgentTool;
import com.taskflow.shared.AgentToolError;
import com.taskflow.shared.CurrentActor;
import com.taskflow.shared.Hashing;
import com.taskflow.shared.IdempotentCalls;
import com.taskflow.shared.LockContention;
import com.taskflow.shared.ProblemResponseWriter;
import com.taskflow.shared.TaskflowException;
import io.modelcontextprotocol.json.McpJsonDefaults;
import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpStatelessServerFeatures;
import io.modelcontextprotocol.server.transport.HttpServletStatelessServerTransport;
import io.modelcontextprotocol.spec.McpSchema;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;

/**
 * The MCP endpoint at {@code /api/v1/mcp} (MCP-1..MCP-4): a stateless streamable-HTTP server, so a
 * client needs only the URL and an API key. It sits behind the normal security chain (no key is
 * 401) and serves service accounts only (AD-11). The tools are the {@link AgentTool} beans of the
 * modules. They run on the request thread ({@code immediateExecution}), so the key filter's
 * security context is the caller of every tool and every write is attributed to the key.
 */
@Configuration
class McpServerConfig {

  static final String PATH = "/api/v1/mcp";
  private static final Logger log = LoggerFactory.getLogger(McpServerConfig.class);

  static final String IDEMPOTENCY_HINT =
      " Send idempotencyKey (a new UUID for each new create or update) so a retry cannot repeat the"
          + " change: the same key and arguments return the first result, the same key with other"
          + " arguments fails with idempotency.key_reused.";

  /** Sorted keys at every level, so the request hash does not depend on argument order. */
  private static final ObjectMapper CANONICAL =
      new ObjectMapper().configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);

  @Bean
  ServletRegistrationBean<HttpServlet> mcpServlet(
      List<AgentTool> tools,
      ObjectMapper mapper,
      ProblemResponseWriter problems,
      IdempotentCalls idempotentCalls) {
    HttpServletStatelessServerTransport transport =
        HttpServletStatelessServerTransport.builder()
            .jsonMapper(McpJsonDefaults.getMapper())
            .messageEndpoint(PATH)
            .build();
    McpServer.sync(transport)
        .serverInfo("taskflow", "1.0.0")
        .instructions(
            "Taskflow work management. Use list_locations to find Lists, then create, read, update,"
                + " move, comment on and delete tasks. Pass the task version you last read when"
                + " updating. Custom fields: list_custom_fields shows a location's fields; pass"
                + " customFields to create_task and update_task and filter with customFields in"
                + " search_tasks. Send an idempotencyKey with create_task, update_task and"
                + " add_comment so a retry does not repeat the change.")
        .capabilities(McpSchema.ServerCapabilities.builder().tools(false).build())
        .tools(tools.stream().map(t -> specification(t, mapper, idempotentCalls)).toList())
        .immediateExecution(true)
        .build();
    ServiceAccountsOnlyServlet servlet = new ServiceAccountsOnlyServlet(transport, problems);
    ServletRegistrationBean<HttpServlet> registration =
        new ServletRegistrationBean<>(servlet, PATH);
    registration.setAsyncSupported(true);
    registration.setName("mcp");
    return registration;
  }

  static McpStatelessServerFeatures.SyncToolSpecification specification(
      AgentTool tool, ObjectMapper mapper, IdempotentCalls idempotentCalls) {
    JsonNode schema = tool.inputSchema();
    String description = tool.description();
    if (tool.idempotent()) {
      ObjectNode withKey = schema.deepCopy();
      withKey
          .withObject("/properties")
          .putObject(AgentTool.IDEMPOTENCY_KEY)
          .put("type", "string")
          .put("minLength", 1)
          .put("maxLength", IdempotentCalls.MAX_KEY_LENGTH)
          .put(
              "description",
              "Optional but recommended: a new UUID per create, reused only to retry the same call");
      schema = withKey;
      description = description + IDEMPOTENCY_HINT;
    }
    McpSchema.Tool definition =
        McpSchema.Tool.builder()
            .name(tool.name())
            .description(description)
            .inputSchema(McpJsonDefaults.getMapper(), schema.toString())
            .build();
    return McpStatelessServerFeatures.SyncToolSpecification.builder()
        .tool(definition)
        .callHandler((context, request) -> call(tool, request, mapper, idempotentCalls))
        .build();
  }

  /**
   * A failure the REST endpoint would answer with problem+json is a tool error with its code. Lock
   * contention raised anywhere in the call, outside a tool's own handling too, is the shared busy
   * answer with its retry hint, like the REST handler, never 500 internal (ClickUp 14yq6g33592).
   */
  static McpSchema.CallToolResult call(
      AgentTool tool,
      McpSchema.CallToolRequest request,
      ObjectMapper mapper,
      IdempotentCalls idempotentCalls) {
    try {
      JsonNode arguments =
          request.arguments() == null
              ? mapper.createObjectNode()
              : mapper.valueToTree(request.arguments());
      if (tool.idempotent() && arguments.has(AgentTool.IDEMPOTENCY_KEY)) {
        return result(mapper, idempotentCall(tool, arguments, mapper, idempotentCalls), false);
      }
      return result(mapper, tool.call(arguments), false);
    } catch (TaskflowException e) {
      return result(mapper, AgentToolError.of(e), true);
    } catch (RuntimeException e) {
      if (LockContention.isContention(e)) {
        log.warn("tool {} hit lock contention: {}", tool.name(), e.toString());
        return result(mapper, AgentToolError.of(LockContention.busy()), true);
      }
      log.error("tool {} failed", tool.name(), e);
      return result(
          mapper,
          AgentToolError.of(
              new TaskflowException(
                  HttpStatus.INTERNAL_SERVER_ERROR, "internal", "The tool call failed")),
          true);
    }
  }

  /**
   * Runs a create tool once per service account and key (decision 005.11). The request hash covers
   * the tool name and every other argument, so the same key with other arguments is refused.
   */
  private static JsonNode idempotentCall(
      AgentTool tool, JsonNode arguments, ObjectMapper mapper, IdempotentCalls idempotentCalls) {
    JsonNode key = arguments.get(AgentTool.IDEMPOTENCY_KEY);
    if (!key.isTextual()) {
      throw TaskflowException.badRequest(
          "idempotency.invalid_key", "idempotencyKey must be a string");
    }
    ObjectNode rest = arguments.deepCopy();
    rest.remove(AgentTool.IDEMPOTENCY_KEY);
    String hash;
    try {
      hash =
          Hashing.sha256Hex(
              "mcp "
                  + tool.name()
                  + "\n"
                  + CANONICAL.writeValueAsString(CANONICAL.convertValue(rest, Object.class)));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
    return idempotentCalls.run(
        CurrentActor.userId(), key.asText(), hash, () -> mapper.valueToTree(tool.call(rest)));
  }

  private static McpSchema.CallToolResult result(ObjectMapper mapper, Object value, boolean error) {
    try {
      return McpSchema.CallToolResult.builder()
          .addTextContent(mapper.writeValueAsString(value))
          .isError(error)
          .build();
    } catch (JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
  }

  /** Answers 403 to anyone but a service account, then hands the request to the MCP transport. */
  static final class ServiceAccountsOnlyServlet extends HttpServlet {

    private final HttpServlet delegate;
    private final ProblemResponseWriter problems;

    ServiceAccountsOnlyServlet(HttpServlet delegate, ProblemResponseWriter problems) {
      this.delegate = delegate;
      this.problems = problems;
    }

    @Override
    protected void service(HttpServletRequest request, HttpServletResponse response)
        throws ServletException, IOException {
      Actor actor = CurrentActor.find().orElse(null);
      if (actor == null) {
        problems.write(
            response, HttpStatus.UNAUTHORIZED, "auth.unauthenticated", "Authentication required");
        return;
      }
      if (actor.type() != ActorType.SERVICE_ACCOUNT) {
        problems.write(
            response,
            HttpStatus.FORBIDDEN,
            "auth.forbidden",
            "The MCP endpoint is for service account API keys");
        return;
      }
      delegate.service(request, response);
    }

    @Override
    public void destroy() {
      delegate.destroy();
    }
  }
}
