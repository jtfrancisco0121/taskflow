package com.taskflow.workspace.internal;

import com.taskflow.workspace.Role;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Test-only: creates an invite and then fails, so the transaction rolls back. */
@Component
class InviteTxProbe {

  private final InviteService service;

  InviteTxProbe(InviteService service) {
    this.service = service;
  }

  @Transactional
  public void inviteThenFail(UUID workspaceId, String email) {
    service.create(workspaceId, email, Role.MEMBER);
    throw new IllegalStateException("rolled back on purpose");
  }
}
