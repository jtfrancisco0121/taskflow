package com.taskflow.shared;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * ClickUp 14yq6g33592: a tool error carries the REST problem fields, and a REST Retry-After becomes
 * {@code retryAfterSeconds}, since an MCP tool result has no response headers.
 */
@DisplayName("MCP tool error body")
class AgentToolErrorTest {

  @Test
  void busyCarriesTheRetryHintInSeconds() {
    var body = AgentToolError.of(LockContention.busy());

    assertThat(body)
        .containsEntry("status", 503)
        .containsEntry("code", "request.busy")
        .containsEntry(AgentToolError.RETRY_AFTER_SECONDS, 1);
  }

  @Test
  void anErrorWithoutRetryAfterHasNoRetryHint() {
    var body = AgentToolError.of(TaskflowException.conflict("dependency.exists", "exists"));

    assertThat(body).containsEntry("code", "dependency.exists");
    assertThat(body).doesNotContainKey(AgentToolError.RETRY_AFTER_SECONDS);
  }

  @Test
  void aRetryAfterThatIsNotWholeSecondsIsLeftOut() {
    var e =
        new TaskflowException(HttpStatus.SERVICE_UNAVAILABLE, "request.busy", "busy")
            .header("Retry-After", "Wed, 21 Oct 2026 07:28:00 GMT");

    assertThat(AgentToolError.of(e)).doesNotContainKey(AgentToolError.RETRY_AFTER_SECONDS);
  }
}
