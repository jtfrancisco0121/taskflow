package com.taskflow.task.internal;

import com.taskflow.identity.AutomationAuthors;
import com.taskflow.shared.Actor;
import com.taskflow.shared.ActorType;
import com.taskflow.shared.CurrentActor;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Who is written as {@code created_by} or {@code author_id}: the caller, except for an automation
 * run, whose actor id is a rule id and not a user. A rule's comments and subtasks are authored by
 * the Workspace's "Automation" user (AD-9).
 */
@Component
class AuthorResolver {

  private final AutomationAuthors authors;

  AuthorResolver(AutomationAuthors authors) {
    this.authors = authors;
  }

  UUID authorOf(UUID workspaceId) {
    Actor actor = CurrentActor.require();
    return actor.type() == ActorType.AUTOMATION ? authors.authorFor(workspaceId) : actor.id();
  }
}
