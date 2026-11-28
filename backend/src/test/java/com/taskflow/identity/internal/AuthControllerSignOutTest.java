package com.taskflow.identity.internal;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.taskflow.identity.UserDirectory;
import jakarta.servlet.http.Cookie;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * ClickUp 14yq6g334r6 item 2: sign-out clears the refresh cookie even when revoking the family
 * fails, so the browser never keeps a token the user asked to drop.
 */
@DisplayName("AUTH-2 sign-out cookie")
@WebMvcTest(AuthController.class)
@AutoConfigureMockMvc(addFilters = false)
class AuthControllerSignOutTest {

  @Autowired private MockMvc mvc;
  @MockitoBean private AuthService auth;
  @MockitoBean private JwtProperties properties;
  @MockitoBean private UserDirectory users;

  @Test
  void signOutClearsTheCookieWhenTheServiceThrows() throws Exception {
    doThrow(new CannotAcquireLockException("lock timeout")).when(auth).signOut(any());

    mvc.perform(post("/api/v1/auth/signout").cookie(new Cookie("refresh_token", "abc")))
        .andExpect(status().is5xxServerError())
        .andExpect(header().string("Set-Cookie", Matchers.containsString("refresh_token=")))
        .andExpect(header().string("Set-Cookie", Matchers.containsString("Max-Age=0")))
        .andExpect(header().string("Set-Cookie", Matchers.containsString("Path=/api/v1/auth")));
  }

  @Test
  void signOutClearsTheCookieOnceWhenTheServiceSucceeds() throws Exception {
    mvc.perform(post("/api/v1/auth/signout").cookie(new Cookie("refresh_token", "abc")))
        .andExpect(status().isNoContent())
        .andExpect(header().stringValues("Set-Cookie", Matchers.<String>iterableWithSize(1)))
        .andExpect(header().string("Set-Cookie", Matchers.containsString("Max-Age=0")));
  }
}
