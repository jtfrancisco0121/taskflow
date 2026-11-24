package com.taskflow.realtime.internal;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

/**
 * Authenticated STOMP sessions: who they are, when their access token expires, which sockets to
 * close at that moment and what they subscribed to (AD-13). The identity is kept here, not read
 * from the pooled inbound threads, so every frame is checked as its own session's user.
 */
@Component
class StompSessions {

  private static final Logger log = LoggerFactory.getLogger(StompSessions.class);

  record Session(Authentication auth, UUID userId, Instant expiresAt) {}

  private final Map<String, Session> sessions = new ConcurrentHashMap<>();
  private final Map<String, WebSocketSession> sockets = new ConcurrentHashMap<>();
  private final Map<String, Map<String, String>> subscriptions = new ConcurrentHashMap<>();
  private final List<Consumer<String>> closeListeners = new ArrayList<>();

  void register(String sessionId, Session session) {
    sessions.put(sessionId, session);
  }

  Session session(String sessionId) {
    return sessionId == null ? null : sessions.get(sessionId);
  }

  void socketOpened(WebSocketSession socket) {
    sockets.put(socket.getId(), socket);
  }

  void subscribed(String sessionId, String subscriptionId, String destination) {
    subscriptions
        .computeIfAbsent(sessionId, k -> new ConcurrentHashMap<>())
        .put(subscriptionId, destination);
  }

  /** The destination of a subscription that is removed, or null. */
  String unsubscribed(String sessionId, String subscriptionId) {
    Map<String, String> subs = subscriptions.get(sessionId);
    return subs == null ? null : subs.remove(subscriptionId);
  }

  Map<String, String> subscriptionsOf(String sessionId) {
    return Map.copyOf(subscriptions.getOrDefault(sessionId, Map.of()));
  }

  void onClose(Consumer<String> listener) {
    closeListeners.add(listener);
  }

  /** Called when the socket closes, for whatever reason. */
  void closed(String sessionId) {
    for (Consumer<String> l : closeListeners) {
      try {
        l.accept(sessionId);
      } catch (RuntimeException e) {
        log.warn("close listener failed: {}", e.toString());
      }
    }
    sessions.remove(sessionId);
    sockets.remove(sessionId);
    subscriptions.remove(sessionId);
  }

  /** The session is closed at its token's {@code exp}; the client reconnects with a fresh token. */
  @Scheduled(fixedDelayString = "${taskflow.realtime.session-sweep-ms:5000}")
  void closeExpired() {
    Instant now = Instant.now();
    for (Map.Entry<String, Session> e : sessions.entrySet()) {
      if (!e.getValue().expiresAt().isAfter(now)) {
        WebSocketSession socket = sockets.get(e.getKey());
        if (socket != null && socket.isOpen()) {
          try {
            socket.close(CloseStatus.POLICY_VIOLATION.withReason("access token expired"));
          } catch (Exception ex) {
            log.debug("closing expired session failed: {}", ex.toString());
          }
        }
      }
    }
  }
}
