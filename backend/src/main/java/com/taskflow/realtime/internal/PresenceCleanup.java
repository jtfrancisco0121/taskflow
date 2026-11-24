package com.taskflow.realtime.internal;

import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/** A closing socket takes its user off every task whose presence topic it had subscribed to. */
@Component
class PresenceCleanup {

  private static final Pattern PRESENCE_TOPIC =
      Pattern.compile("^/topic/task/([0-9a-fA-F-]{36})/presence$");

  PresenceCleanup(StompSessions sessions, PresenceService presence) {
    sessions.onClose(sessionId -> {
      StompSessions.Session session = sessions.session(sessionId);
      if (session == null) {
        return;
      }
      for (String destination : sessions.subscriptionsOf(sessionId).values()) {
        Matcher m = PRESENCE_TOPIC.matcher(destination);
        if (m.matches()) {
          presence.leave(UUID.fromString(m.group(1)), session.userId());
        }
      }
    });
  }
}
