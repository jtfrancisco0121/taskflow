-- Indexes for the view query compiler (S2). Each one is justified by the EXPLAIN of the demo
-- Workspace query (1,000 tasks, Space scope, filter + sort), run on postgres:18.

-- Sorting and range filters on due date inside a Workspace (Calendar range, due-date sort and the
-- overdue/today buckets) read tasks by (workspace, list, due_date) instead of scanning the table.
CREATE INDEX task_workspace_list_due_idx ON task (workspace_id, list_id, due_date, id)
    WHERE deleted_at IS NULL;

-- "Recently updated" sorts and updatedAt range filters at Workspace scope.
CREATE INDEX task_workspace_updated_idx ON task (workspace_id, updated_at, id)
    WHERE deleted_at IS NULL;

-- Tag filters probe task_tag by tag name inside a Workspace (any_of / all_of / none_of).
CREATE INDEX task_tag_workspace_tag_idx ON task_tag (workspace_id, tag, task_id);
