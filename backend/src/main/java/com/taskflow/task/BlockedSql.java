package com.taskflow.task;

/**
 * The one SQL definition of "blocked" (DEP, AD-3). Every layer that needs the answer builds its SQL
 * from here: the task reads, the {@code blocked} view filter, workspace search and the agent
 * search. The strings are plain SQL with no bind parameters, so they work as a fragment of a
 * JdbcTemplate query and, wrapped in {@code DSL.condition(..)} / {@code DSL.field(..)}, of a jOOQ
 * query (the {@code LocationAccess} pattern).
 *
 * <p>A task is <b>unfinished</b> when it is not in the trash, its List is not deleted (an archived
 * List still counts) and its status group is NOT_STARTED or ACTIVE. A task is <b>blocked</b> when
 * it waits on at least one unfinished task. Who may see the blocker never enters the answer.
 */
public final class BlockedSql {

  private BlockedSql() {}

  /**
   * A boolean expression: the task aliased {@code alias} is unfinished. The alias must expose
   * {@code deleted_at}, {@code status_id} and {@code list_id}.
   */
  public static String unfinished(String alias) {
    String s = "us_" + alias;
    String l = "ul_" + alias;
    return "("
        + alias
        + ".deleted_at IS NULL AND EXISTS (SELECT 1 FROM status "
        + s
        + " WHERE "
        + s
        + ".id = "
        + alias
        + ".status_id AND "
        + s
        + ".status_group IN ('NOT_STARTED', 'ACTIVE')) AND EXISTS (SELECT 1 FROM location "
        + l
        + " WHERE "
        + l
        + ".id = "
        + alias
        + ".list_id AND "
        + l
        + ".deleted_at IS NULL))";
  }

  /**
   * A boolean expression: the task aliased {@code alias} waits on an unfinished task. The alias
   * must expose {@code id} and {@code workspace_id}.
   */
  public static String blocked(String alias) {
    return "EXISTS (" + blockers("1", alias) + ")";
  }

  /** An integer expression: how many unfinished tasks the task aliased {@code alias} waits on. */
  public static String blockerCount(String alias) {
    return "(" + blockers("count(*)", alias) + ")";
  }

  private static String blockers(String select, String alias) {
    return "SELECT "
        + select
        + " FROM task_dependency bd JOIN task bb ON bb.workspace_id = bd.workspace_id AND bb.id ="
        + " bd.depends_on_id WHERE bd.workspace_id = "
        + alias
        + ".workspace_id AND bd.task_id = "
        + alias
        + ".id AND bd.type = 'WAITING_ON' AND "
        + unfinished("bb");
  }
}
