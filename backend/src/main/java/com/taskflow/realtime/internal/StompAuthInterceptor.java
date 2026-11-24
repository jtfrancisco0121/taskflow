package com.taskflow.realtime.internal;

import com.taskflow.shared.Actor;
import com.taskflow.workspace.Action;
import com.taskflow.workspace.Permissions;
import com.taskflow.workspace.WorkspaceQuery;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessagingException;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;

/**
 * Authentication and authorization of every inbound STOMP frame (AD-13). CONNECT needs a valid
 * access token. Every other frame is checked as the session's own user: the context is set before
 * the checks and cleared after the send, because inbound threads are pooled. The rules are deny by
 * default: SUBSCRIBE only to the four topic patterns (with their permission), SEND only to {@code
 * /app/presence/{taskId}}. A refused frame throws, which becomes a STOMP ERROR, and never reaches
 * the broker that would relay a SEND to {@code /topic/**} to every subscriber.
 */
class StompAuthInterceptor implements ChannelInterceptor {

  private static final String UUID_RE =
      "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
  private static final Pattern WORKSPACE_TOPIC =
      Pattern.compile("^/topic/workspace/(" + UUID_RE + ")$");
  private static final Pattern LOCATION_TOPIC =
      Pattern.compile("^/topic/location/(" + UUID_RE + ")$");
  private static final Pattern TASK_TOPIC = Pattern.compile("^/topic/task/(" + UUID_RE + ")$");
  private static final Pattern PRESENCE_TOPIC =
      Pattern.compile("^/topic/task/(" + UUID_RE + ")/presence$");
  private static final Pattern PRESENCE_SEND = Pattern.compile("^/app/presence/(" + UUID_RE + ")$");

  private final JwtDecoder decoder;
  private final StompSessions sessions;
  private final Permissions permissions;
  private final WorkspaceQuery workspaces;
  private final PresenceService presence;

  StompAuthInterceptor(
      JwtDecoder decoder,
      StompSessions sessions,
      Permissions permissions,
      WorkspaceQuery workspaces,
      PresenceService presence) {
    this.decoder = decoder;
    this.sessions = sessions;
    this.permissions = permissions;
    this.workspaces = workspaces;
    this.presence = presence;
  }

  @Override
  public Message<?> preSend(Message<?> message, MessageChannel channel) {
    StompHeaderAccessor acc = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
    if (acc == null || acc.getCommand() == null) {
      return message; // heartbeats and internal frames
    }
    StompCommand command = acc.getCommand();
    if (command == StompCommand.CONNECT || command == StompCommand.STOMP) {
      connect(acc);
      return message;
    }
    StompSessions.Session session = sessions.session(acc.getSessionId());
    if (session == null) {
      throw new MessagingException("Not authenticated");
    }
    if (!session.expiresAt().isAfter(java.time.Instant.now())) {
      throw new MessagingException("The access token expired; reconnect");
    }
    SecurityContextHolder.getContext().setAuthentication(session.auth());
    acc.setUser(session.auth());
    switch (command) {
      case SUBSCRIBE -> subscribe(acc, session);
      case SEND -> send(acc);
      case UNSUBSCRIBE -> unsubscribe(acc, session);
      case DISCONNECT -> {}
      default -> throw new MessagingException("Unsupported frame " + command);
    }
    return message;
  }

  @Override
  public void afterSendCompletion(
      Message<?> message, MessageChannel channel, boolean sent, Exception ex) {
    SecurityContextHolder.clearContext();
  }

  private void connect(StompHeaderAccessor acc) {
    List<String> auth = acc.getNativeHeader("Authorization");
    String header = auth == null || auth.isEmpty() ? null : auth.get(0);
    if (header == null || !header.regionMatches(true, 0, "Bearer ", 0, 7)) {
      throw new MessagingException("A Bearer access token is required");
    }
    Jwt jwt;
    try {
      jwt = decoder.decode(header.substring(7).trim());
    } catch (JwtException | IllegalArgumentException e) {
      throw new MessagingException("Invalid or expired access token");
    }
    UUID userId;
    try {
      userId = UUID.fromString(jwt.getSubject());
    } catch (RuntimeException e) {
      throw new MessagingException("Invalid access token");
    }
    UsernamePasswordAuthenticationToken auth0 =
        UsernamePasswordAuthenticationToken.authenticated(
            Actor.user(userId), jwt, List.of(new SimpleGrantedAuthority("ROLE_USER")));
    sessions.register(
        acc.getSessionId(),
        new StompSessions.Session(
            auth0,
            userId,
            jwt.getExpiresAt() == null ? java.time.Instant.now() : jwt.getExpiresAt()));
    acc.setUser(auth0);
  }

  private void subscribe(StompHeaderAccessor acc, StompSessions.Session session) {
    String destination = acc.getDestination();
    if (destination == null) {
      throw new MessagingException("A subscription needs a destination");
    }
    Matcher m;
    if ((m = LOCATION_TOPIC.matcher(destination)).matches()) {
      permissions.require(Permissions.LOCATION, UUID.fromString(m.group(1)), Action.VIEW);
    } else if ((m = TASK_TOPIC.matcher(destination)).matches()
        || (m = PRESENCE_TOPIC.matcher(destination)).matches()) {
      permissions.require(Permissions.TASK, UUID.fromString(m.group(1)), Action.VIEW);
    } else if ((m = WORKSPACE_TOPIC.matcher(destination)).matches()) {
      UUID workspaceId = UUID.fromString(m.group(1));
      permissions.require(Permissions.WORKSPACE, workspaceId, Action.VIEW);
      // WORKSPACE VIEW includes guests, who may see only their granted subtrees (AD-13)
      boolean canWork =
          workspaces.roleOf(workspaceId, session.userId()).map(r -> r.canWork()).orElse(false);
      if (!canWork) {
        throw new MessagingException("Guests subscribe to the Locations they were granted");
      }
    } else {
      throw new MessagingException("Unknown destination");
    }
    String subscriptionId = acc.getSubscriptionId();
    if (subscriptionId != null) {
      sessions.subscribed(acc.getSessionId(), subscriptionId, destination);
    }
  }

  private void send(StompHeaderAccessor acc) {
    String destination = acc.getDestination();
    Matcher m = destination == null ? null : PRESENCE_SEND.matcher(destination);
    if (m == null || !m.matches()) {
      throw new MessagingException("Clients may only send presence heartbeats");
    }
    permissions.require(Permissions.TASK, UUID.fromString(m.group(1)), Action.VIEW);
  }

  private void unsubscribe(StompHeaderAccessor acc, StompSessions.Session session) {
    String subscriptionId = acc.getSubscriptionId();
    if (subscriptionId == null) {
      return;
    }
    String destination = sessions.unsubscribed(acc.getSessionId(), subscriptionId);
    if (destination != null) {
      Matcher m = PRESENCE_TOPIC.matcher(destination);
      if (m.matches()) {
        presence.leave(UUID.fromString(m.group(1)), session.userId());
      }
    }
  }
}
