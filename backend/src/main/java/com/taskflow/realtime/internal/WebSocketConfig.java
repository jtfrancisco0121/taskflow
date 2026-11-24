package com.taskflow.realtime.internal;

import com.taskflow.workspace.Permissions;
import com.taskflow.workspace.WorkspaceQuery;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;
import org.springframework.web.socket.handler.WebSocketHandlerDecorator;

/**
 * STOMP over native WebSocket at {@code /ws} with an in-memory broker on {@code /topic} (AD-13).
 */
@Configuration
@EnableWebSocketMessageBroker
@EnableConfigurationProperties(RealtimeProperties.class)
class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

  private final JwtDecoder decoder;
  private final StompSessions sessions;
  private final Permissions permissions;
  private final WorkspaceQuery workspaces;
  private final PresenceService presence;
  private final TaskScheduler heartbeats;

  WebSocketConfig(
      JwtDecoder decoder,
      StompSessions sessions,
      Permissions permissions,
      WorkspaceQuery workspaces,
      PresenceService presence,
      @Qualifier("stompHeartbeatScheduler") TaskScheduler heartbeats) {
    this.decoder = decoder;
    this.sessions = sessions;
    this.permissions = permissions;
    this.workspaces = workspaces;
    this.presence = presence;
    this.heartbeats = heartbeats;
  }

  @Bean
  static ThreadPoolTaskScheduler stompHeartbeatScheduler() {
    ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
    scheduler.setPoolSize(1);
    scheduler.setThreadNamePrefix("stomp-heartbeat-");
    return scheduler;
  }

  @Override
  public void registerStompEndpoints(StompEndpointRegistry registry) {
    // The handshake carries no credentials; the token is checked on CONNECT.
    registry.addEndpoint("/ws").setAllowedOriginPatterns("*");
  }

  @Override
  public void configureMessageBroker(MessageBrokerRegistry registry) {
    registry
        .enableSimpleBroker("/topic")
        .setHeartbeatValue(new long[] {10000, 10000})
        .setTaskScheduler(heartbeats);
    registry.setApplicationDestinationPrefixes("/app");
  }

  @Override
  public void configureClientInboundChannel(ChannelRegistration registration) {
    registration.interceptors(
        new StompAuthInterceptor(decoder, sessions, permissions, workspaces, presence));
  }

  @Override
  public void configureWebSocketTransport(WebSocketTransportRegistration registry) {
    registry.addDecoratorFactory(handler ->
        new WebSocketHandlerDecorator(handler) {
          @Override
          public void afterConnectionEstablished(
              org.springframework.web.socket.WebSocketSession session) throws Exception {
            sessions.socketOpened(session);
            super.afterConnectionEstablished(session);
          }

          @Override
          public void afterConnectionClosed(
              org.springframework.web.socket.WebSocketSession session,
              org.springframework.web.socket.CloseStatus closeStatus)
              throws Exception {
            try {
              super.afterConnectionClosed(session, closeStatus);
            } finally {
              sessions.closed(session.getId());
            }
          }
        });
  }
}
