package com.taskflow.workspace.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.taskflow.shared.Actor;
import com.taskflow.shared.TaskflowException;
import com.taskflow.workspace.Action;
import com.taskflow.workspace.Role;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

@DisplayName("AUTH-3 permission evaluator, workspace rows")
class PermissionEvaluatorTest {

  private final UUID workspace = UUID.randomUUID();
  private final UUID user = UUID.randomUUID();

  @AfterEach
  void clear() {
    SecurityContextHolder.clearContext();
  }

  private PermissionEvaluatorImpl evaluatorFor(Role role) {
    SecurityContextHolder.getContext()
        .setAuthentication(
            UsernamePasswordAuthenticationToken.authenticated(
                Actor.user(user), null, List.of(new SimpleGrantedAuthority("ROLE_USER"))));
    MembershipLookup lookup = mock(MembershipLookup.class);
    when(lookup.role(any(), any())).thenReturn(Optional.ofNullable(role));
    return new PermissionEvaluatorImpl(new PermissionService(lookup));
  }

  private boolean allowed(Role role, Action action) {
    PermissionEvaluatorImpl evaluator = evaluatorFor(role);
    try {
      return evaluator.hasPermission(
          SecurityContextHolder.getContext().getAuthentication(),
          workspace,
          "WORKSPACE",
          action.name());
    } catch (TaskflowException e) {
      assertThat(e.status().value()).isEqualTo(403);
      return false;
    }
  }

  @Test
  void everyoneInTheWorkspaceMayViewAndComment() {
    for (Role role : Role.values()) {
      assertThat(allowed(role, Action.VIEW)).as("%s VIEW", role).isTrue();
      assertThat(allowed(role, Action.COMMENT)).as("%s COMMENT", role).isTrue();
    }
  }

  @Test
  void ownerAndAdminMayRenameAndManage() {
    assertThat(allowed(Role.OWNER, Action.EDIT)).isTrue();
    assertThat(allowed(Role.ADMIN, Action.EDIT)).isTrue();
    assertThat(allowed(Role.MEMBER, Action.EDIT)).isFalse();
    assertThat(allowed(Role.GUEST, Action.EDIT)).isFalse();
    assertThat(allowed(Role.OWNER, Action.MANAGE)).isTrue();
    assertThat(allowed(Role.ADMIN, Action.MANAGE)).isTrue();
    assertThat(allowed(Role.MEMBER, Action.MANAGE)).isFalse();
    assertThat(allowed(Role.GUEST, Action.MANAGE)).isFalse();
  }

  @Test
  void onlyTheOwnerMayDeleteTheWorkspace() {
    assertThat(allowed(Role.OWNER, Action.DELETE)).isTrue();
    assertThat(allowed(Role.ADMIN, Action.DELETE)).isFalse();
    assertThat(allowed(Role.MEMBER, Action.DELETE)).isFalse();
    assertThat(allowed(Role.GUEST, Action.DELETE)).isFalse();
  }

  @Test
  void aNonMemberGets404NotAHint() {
    PermissionEvaluatorImpl evaluator = evaluatorFor(null);
    assertThatThrownBy(() ->
            evaluator.hasPermission(
                SecurityContextHolder.getContext().getAuthentication(),
                workspace,
                "WORKSPACE",
                "VIEW"))
        .isInstanceOfSatisfying(
            TaskflowException.class, e -> assertThat(e.status().value()).isEqualTo(404));
  }

  @Test
  void unknownActionsAndTypesAreDenied() {
    PermissionEvaluatorImpl evaluator = evaluatorFor(Role.OWNER);
    var auth = SecurityContextHolder.getContext().getAuthentication();
    assertThat(evaluator.hasPermission(auth, workspace, "WORKSPACE", "FLY")).isFalse();
    assertThat(evaluator.hasPermission(auth, "not-a-uuid", "WORKSPACE", "VIEW")).isFalse();
    assertThat(evaluator.hasPermission(auth, (Object) workspace, "VIEW")).isFalse();
    assertThat(allowed(Role.OWNER, Action.CREATE)).isFalse();
  }
}
