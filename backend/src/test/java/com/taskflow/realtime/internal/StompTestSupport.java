package com.taskflow.realtime.internal;

import com.fasterxml.jackson.databind.JsonNode;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.taskflow.IntegrationTest;
import com.taskflow.TestcontainersConfiguration;
import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.messaging.converter.CompositeMessageConverter;
import org.springframework.messaging.converter.MappingJackson2MessageConverter;
import org.springframework.messaging.converter.StringMessageConverter;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

/** A real STOMP client against the application under test. */
abstract class StompTestSupport extends IntegrationTest {

  @LocalServerPort protected int port;

  /** One connection: its session when CONNECTED, and every ERROR frame it received. */
  protected static final class Conn implements AutoCloseable {
    final WebSocketStompClient client;
    volatile StompSession session;
    final CountDownLatch connected = new CountDownLatch(1);
    final BlockingQueue<String> errors = new LinkedBlockingQueue<>();
    final BlockingQueue<String> messages = new LinkedBlockingQueue<>();

    Conn(WebSocketStompClient client) {
      this.client = client;
    }

    boolean isConnected() {
      return session != null && session.isConnected();
    }

    /** True when an ERROR frame arrives within the time. */
    String awaitError(long millis) throws InterruptedException {
      return errors.poll(millis, TimeUnit.MILLISECONDS);
    }

    void subscribe(String destination) {
      session.subscribe(
          destination,
          new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
              return JsonNode.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
              messages.add(String.valueOf(payload));
            }
          });
    }

    @Override
    public void close() {
      try {
        if (session != null && session.isConnected()) {
          session.disconnect();
        }
      } catch (RuntimeException closedAlready) {
        // the server closes the connection after an ERROR frame
      } finally {
        client.stop();
      }
    }
  }

  protected Conn connect(int serverPort, String token) throws Exception {
    return connect(serverPort, token, 3000);
  }

  protected Conn connect(int serverPort, String token, long waitMillis) throws Exception {
    WebSocketStompClient client = new WebSocketStompClient(new StandardWebSocketClient());
    client.setMessageConverter(
        new CompositeMessageConverter(
            List.of(new MappingJackson2MessageConverter(), new StringMessageConverter())));
    Conn conn = new Conn(client);
    StompHeaders headers = new StompHeaders();
    if (token != null) {
      headers.add("Authorization", "Bearer " + token);
    }
    client.connectAsync(
        "ws://localhost:" + serverPort + "/ws",
        new WebSocketHttpHeaders(),
        headers,
        new StompSessionHandlerAdapter() {
          @Override
          public void afterConnected(StompSession session, StompHeaders connectedHeaders) {
            conn.session = session;
            conn.connected.countDown();
          }

          @Override
          public Type getPayloadType(StompHeaders headers) {
            return String.class;
          }

          @Override
          public void handleFrame(StompHeaders headers, Object payload) {
            conn.errors.add(headers.getFirst("message") + " " + payload);
          }

          @Override
          public void handleException(
              StompSession session,
              StompCommand command,
              StompHeaders headers,
              byte[] payload,
              Throwable exception) {
            conn.errors.add(String.valueOf(exception));
          }

          @Override
          public void handleTransportError(StompSession session, Throwable exception) {
            conn.errors.add("transport: " + exception);
          }
        });
    conn.connected.await(waitMillis, TimeUnit.MILLISECONDS);
    return conn;
  }

  protected String expiredToken(UUID userId) {
    return tokenExpiringIn(userId, -3600);
  }

  protected String tokenExpiringIn(UUID userId, long seconds) {
    SecretKeySpec key =
        new SecretKeySpec(
            TestcontainersConfiguration.JWT_SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    NimbusJwtEncoder encoder = new NimbusJwtEncoder(new ImmutableSecret<>(key));
    JwtClaimsSet claims =
        JwtClaimsSet.builder()
            .subject(userId.toString())
            .issuedAt(Instant.now().minusSeconds(7200))
            .expiresAt(Instant.now().plusSeconds(seconds))
            .build();
    return encoder
        .encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims))
        .getTokenValue();
  }

  protected static JsonNode json(com.fasterxml.jackson.databind.ObjectMapper mapper, String raw)
      throws Exception {
    return mapper.readTree(raw);
  }

  protected static boolean anyContains(List<String> messages, String text) {
    return messages.stream().anyMatch(m -> m.contains(text));
  }
}
