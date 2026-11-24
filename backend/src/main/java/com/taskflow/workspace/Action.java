package com.taskflow.workspace;

/**
 * What a caller wants to do with a resource (AD-3). CREATE adds a child under a location, so a
 * member can add a Folder to a Space they cannot edit; UNARCHIVE and RESTORE are allowed on
 * archived locations and trashed tasks, where every other write is refused.
 */
public enum Action {
  VIEW,
  COMMENT,
  EDIT,
  CREATE,
  MANAGE,
  DELETE,
  UNARCHIVE,
  RESTORE
}
