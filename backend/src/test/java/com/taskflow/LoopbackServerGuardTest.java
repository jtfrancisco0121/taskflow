package com.taskflow;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.BindException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * ClickUp 14yq6g334e2 (PresenceIT: 4 x "signup failed: 404 not found", seen once). The test server
 * listened on the wildcard address, and the clients called {@code localhost}. On macOS another
 * process may then bind the same port on 127.0.0.1 with SO_REUSEADDR (as Node and the JVM do), and
 * the more specific 127.0.0.1 socket takes every localhost connection: the requests reach a
 * stranger. The body "not found" is what the other local loopback servers on that machine answer.
 * The fix binds the test server to 127.0.0.1, where the OS refuses a second bind of the same port,
 * and points every client at that address.
 */
@DisplayName("Integration test server and clients use 127.0.0.1 only")
class LoopbackServerGuardTest {

  @Test
  void theTestServerBindsToLoopbackOnly() {
    SpringBootTest boot = IntegrationTest.class.getAnnotation(SpringBootTest.class);
    assertThat(boot.properties()).contains("server.address=" + IntegrationTest.HOST);
    assertThat(IntegrationTest.HOST).isEqualTo("127.0.0.1");
  }

  @Test
  void noTestClientCallsLocalhost() throws IOException {
    List<String> offenders;
    try (Stream<Path> files = Files.walk(Path.of("src/test/java"))) {
      offenders =
          files
              .filter(p -> p.toString().endsWith(".java"))
              .filter(p -> !p.endsWith("LoopbackServerGuardTest.java"))
              .filter(LoopbackServerGuardTest::mentionsLocalhostUrl)
              .map(Path::toString)
              .toList();
    }
    assertThat(offenders).as("use IntegrationTest.HOST, not localhost").isEmpty();
  }

  /** What the fix relies on: a port held on 127.0.0.1 cannot be bound there a second time. */
  @Test
  void aSecondBindOfALoopbackPortIsRefused() throws IOException {
    InetAddress loopback = InetAddress.getByName(IntegrationTest.HOST);
    try (ServerSocket server = new ServerSocket()) {
      server.setReuseAddress(true);
      server.bind(new InetSocketAddress(loopback, 0));
      try (ServerSocket intruder = new ServerSocket()) {
        intruder.setReuseAddress(true);
        assertThatThrownBy(
                () -> intruder.bind(new InetSocketAddress(loopback, server.getLocalPort())))
            .isInstanceOf(BindException.class);
      }
    }
  }

  private static boolean mentionsLocalhostUrl(Path file) {
    try {
      return Files.readString(file).contains("://localhost");
    } catch (IOException e) {
      throw new java.io.UncheckedIOException(e);
    }
  }
}
