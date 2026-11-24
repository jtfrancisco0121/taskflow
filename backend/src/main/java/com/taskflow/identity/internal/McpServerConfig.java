package com.taskflow.identity.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.taskflow.shared.Actor;
import com.taskflow.shared.ActorType;
import com.taskflow.shared.AgentTool;
import com.taskflow.shared.AgentToolError;
import com.taskflow.shared.CurrentActor;
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

  @Bean
  ServletRegistrationBean<HttpServlet> mcpServlet(
      List<AgentTool> tools, ObjectMapper mapper, ProblemResponseWriter problems) {
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
                + " updating.")
        .capabilities(McpSchema.ServerCapabilities.builder().tools(false).build())
        .tools(tools.stream().map(t -> specification(t, mapper)).toList())
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
      AgentTool tool, ObjectMapper mapper) {
    McpSchema.Tool definition =
        McpSchema.Tool.builder()
            .name(tool.name())
            .description(tool.description())
            .inputSchema(McpJsonDefaults.getMapper(), tool.inputSchema().toString())
            .build();
    return McpStatelessServerFeatures.SyncToolSpecification.builder()
        .tool(definition)
        .callHandler((context, request) -> call(tool, request, mapper))
        .build();
  }

  /** A failure the REST endpoint would answer with problem+json is a tool error with its code. */
  static McpSchema.CallToolResult call(
      AgentTool tool, McpSchema.CallToolRequest request, ObjectMapper mapper) {
    try {
      JsonNode arguments =
          request.arguments() == null
              ? mapper.createObjectNode()
              : mapper.valueToTree(request.arguments());
      return result(mapper, tool.call(arguments), false);
    } catch (TaskflowException e) {
      return result(mapper, AgentToolError.of(e), true);
    } catch (RuntimeException e) {
      log.error("tool {} failed", tool.name(), e);
      return result(
          mapper,
          AgentToolError.of(
              new TaskflowException(
                  HttpStatus.INTERNAL_SERVER_ERROR, "internal", "The tool call failed")),
          true);
    }
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
