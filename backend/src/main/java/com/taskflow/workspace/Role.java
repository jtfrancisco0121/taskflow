package com.taskflow.workspace;

/** A member's one role in a workspace (AUTH-3). */
public enum Role {
  OWNER,
  ADMIN,
  MEMBER,
  GUEST;

  public boolean isAdminOrOwner() {
    return this == OWNER || this == ADMIN;
  }

  /** Owner, admin and member: everyone who is not a guest. */
  public boolean canWork() {
    return this != GUEST;
  }
}
