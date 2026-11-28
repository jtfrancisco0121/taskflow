package com.taskflow;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.BindException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.web.server.LocalServerPort;

/**
 * ClickUp 14yq6g334e2, the PresenceIT "signup failed: 404 not found" flake reproduced on purpose: a
 * stranger binds the test server's port on 127.0.0.1 with SO_REUSEADDR. With the server on the
 * wildcard address that bind succeeds on macOS and takes every localhost request; with the server
 * on 127.0.0.1 the OS refuses it and sign-up still reaches the application.
 */
@DisplayName("14yq6g334e2 no other process can take the test server's port")
class LoopbackPortTakeoverIT extends IntegrationTest {

  @LocalServerPort int port;

  @Test
  void aStrangerCannotBindTheServerPortOnLoopbackAndSignUpStillWorks() throws Exception {
    try (ServerSocket stranger = new ServerSocket()) {
      stranger.setReuseAddress(true);
      assertThatThrownBy(
              () -> stranger.bind(new InetSocketAddress(InetAddress.getByName(HOST), port)))
          .isInstanceOf(BindException.class);
    }
    assertThat(signUp("Takeover").token()).isNotBlank();
  }
}
