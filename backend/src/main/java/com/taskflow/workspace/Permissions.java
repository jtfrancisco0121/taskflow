package com.taskflow.workspace;

import java.util.UUID;

/**
 * Explicit permission checks for ids that arrive in a request body, where {@code @PreAuthorize}
 * cannot see them (AD-3). It throws: 404 when the resource is not visible to the caller, 403 when
 * it is visible but the action is not allowed, 409 when it is archived.
 */
public interface Permissions {

  String WORKSPACE = "WORKSPACE";
  String LOCATION = "LOCATION";
  String TASK = "TASK";
  String COMMENT = "COMMENT";
  String CHECKLIST = "CHECKLIST";

  void require(String type, UUID id, Action action);
}
