package com.taskflow.realtime.internal;

import com.taskflow.shared.Actor;
import java.security.Principal;
import java.util.UUID;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;

/**
 * {@code /app/presence/{taskId}}: the heartbeat of a client viewing a task (permission checked).
 */
@Controller
class PresenceController {

  private final PresenceService presence;

  PresenceController(PresenceService presence) {
    this.presence = presence;
  }

  @MessageMapping("/presence/{taskId}")
  void heartbeat(@DestinationVariable UUID taskId, Principal principal) {
    if (principal instanceof Authentication auth && auth.getPrincipal() instanceof Actor actor) {
      presence.heartbeat(taskId, actor.id());
    }
  }
}
