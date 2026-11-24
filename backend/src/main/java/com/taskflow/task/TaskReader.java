package com.taskflow.task;

import java.util.List;
import java.util.UUID;

/**
 * Public batch read of tasks for other modules (AD-2). It performs no permission check: callers
 * pass ids they selected under the visibility rule.
 */
public interface TaskReader {

  /** The live tasks with these ids, with assignees and tags, in the order of {@code ids}. */
  List<TaskView> views(List<UUID> ids);
}
