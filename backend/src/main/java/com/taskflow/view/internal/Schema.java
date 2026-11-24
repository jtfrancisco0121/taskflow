package com.taskflow.view.internal;

import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DataType;
import org.jooq.Field;
import org.jooq.Table;
import org.jooq.impl.DSL;
import org.jooq.impl.SQLDataType;

/**
 * Every table and column the view queries touch, declared once (AD-3). There is no code generation:
 * Flyway owns the schema and these are plain references. Aliases: {@code t} task, {@code l}
 * location, {@code s} status, {@code ga} the assignee row a group is built from.
 */
final class Schema {

  private Schema() {}

  static final DataType<UUID> UUID_T = SQLDataType.UUID;
  static final DataType<String> TEXT = SQLDataType.CLOB;
  static final DataType<OffsetDateTime> TSTZ = SQLDataType.TIMESTAMPWITHTIMEZONE;

  static <T> Field<T> col(String alias, String column, DataType<T> type) {
    return DSL.field(DSL.name(alias, column), type);
  }

  static Table<?> table(String name, String alias) {
    return DSL.table(DSL.name(name)).as(alias);
  }

  // task t
  static final Table<?> TASK = table("task", "t");
  static final Field<UUID> T_ID = col("t", "id", UUID_T);
  static final Field<UUID> T_WORKSPACE = col("t", "workspace_id", UUID_T);
  static final Field<UUID> T_LIST = col("t", "list_id", UUID_T);
  static final Field<UUID> T_PARENT = col("t", "parent_task_id", UUID_T);
  static final Field<UUID> T_STATUS = col("t", "status_id", UUID_T);
  static final Field<String> T_TITLE = col("t", "title", TEXT);
  static final Field<String> T_PRIORITY = col("t", "priority", TEXT);
  static final Field<String> T_RANK = col("t", "rank", TEXT);
  static final Field<OffsetDateTime> T_START = col("t", "start_date", TSTZ);
  static final Field<OffsetDateTime> T_DUE = col("t", "due_date", TSTZ);
  static final Field<OffsetDateTime> T_CREATED = col("t", "created_at", TSTZ);
  static final Field<OffsetDateTime> T_UPDATED = col("t", "updated_at", TSTZ);
  static final Field<OffsetDateTime> T_DELETED = col("t", "deleted_at", TSTZ);

  // location l
  static final Table<?> LOCATION = table("location", "l");
  static final Field<UUID> L_ID = col("l", "id", UUID_T);
  static final Field<UUID> L_WORKSPACE = col("l", "workspace_id", UUID_T);
  static final Field<String> L_NAME = col("l", "name", TEXT);
  static final Field<OffsetDateTime> L_ARCHIVED = col("l", "archived_at", TSTZ);

  // status s
  static final Table<?> STATUS = table("status", "s");
  static final Field<UUID> S_ID = col("s", "id", UUID_T);
  static final Field<UUID> S_WORKSPACE = col("s", "workspace_id", UUID_T);
  static final Field<String> S_NAME = col("s", "name", TEXT);
  static final Field<String> S_GROUP = col("s", "status_group", TEXT);

  // task_assignee: ga (grouping join), fa (filter subquery)
  static final Table<?> GROUP_ASSIGNEE = table("task_assignee", "ga");
  static final Field<UUID> GA_TASK = col("ga", "task_id", UUID_T);
  static final Field<UUID> GA_USER = col("ga", "user_id", UUID_T);
  static final Table<?> FILTER_ASSIGNEE = table("task_assignee", "fa");
  static final Field<UUID> FA_TASK = col("fa", "task_id", UUID_T);
  static final Field<UUID> FA_USER = col("fa", "user_id", UUID_T);

  // task_tag ft (filter subquery)
  static final Table<?> FILTER_TAG = table("task_tag", "ft");
  static final Field<UUID> FT_TASK = col("ft", "task_id", UUID_T);
  static final Field<String> FT_TAG = col("ft", "tag", TEXT);

  // status fs (status group filter subquery)
  static final Table<?> FILTER_STATUS = table("status", "fs");
  static final Field<UUID> FS_ID = col("fs", "id", UUID_T);
  static final Field<UUID> FS_WORKSPACE = col("fs", "workspace_id", UUID_T);
  static final Field<String> FS_GROUP = col("fs", "status_group", TEXT);
}
