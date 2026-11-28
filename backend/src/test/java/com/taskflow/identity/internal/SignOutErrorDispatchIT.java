package com.taskflow.identity.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;

import com.taskflow.IntegrationTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * ClickUp 14yq6g334r6 slice 2: an error no handler maps (a plain RuntimeException) goes through
 * Tomcat's /error dispatch; the clearing Set-Cookie written in the controller's finally must
 * survive it. Real server on a random port, not MockMvc, which has no error dispatch.
 */
@DisplayName("AUTH-2 sign-out cookie through the error dispatch")
class SignOutErrorDispatchIT extends IntegrationTest {

  @MockitoBean private AuthService auth;

  @Test
  void anUnhandledSignOutErrorIs500AndStillClearsTheCookie() {
    doThrow(new IllegalStateException("unexpected")).when(auth).signOut(any());

    Resp answer = post("/api/v1/auth/signout", null, null, "Cookie", "refresh_token=abc");

    assertThat(answer.status()).isEqualTo(500);
    assertThat(answer.headers().get("Set-Cookie"))
        .anySatisfy(c -> assertThat(c).startsWith("refresh_token=;").contains("Max-Age=0"));
  }
}
