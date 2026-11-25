-- task owns the due-date signals (3C S5, decision 009.3). One row per task, due date and kind records that
-- the sweep already emitted task.due_soon or task.due_reached, so several instances (and a restart) emit each
-- event once. Changing the due date makes a new key, so the new date gets its own events.
CREATE TABLE task_due_signal (
    workspace_id uuid        NOT NULL,
    task_id      uuid        NOT NULL,
    due_date     timestamptz NOT NULL,
    kind         text        NOT NULL CHECK (kind IN ('DUE_SOON', 'DUE_REACHED')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, due_date, kind),
    FOREIGN KEY (workspace_id, task_id) REFERENCES task (workspace_id, id) ON DELETE CASCADE
);

-- Deploy-time backfill (AD-10): no flood for what is already due, and no suppression of what is coming.
-- Tasks already past due get both signals. Tasks due within the next 24 hours get only DUE_SOON, so
-- their task.due_reached still fires when the instant comes.
INSERT INTO task_due_signal (workspace_id, task_id, due_date, kind)
SELECT workspace_id, id, due_date, 'DUE_SOON'
FROM task
WHERE deleted_at IS NULL AND due_date IS NOT NULL AND due_date <= now() + interval '24 hours';

INSERT INTO task_due_signal (workspace_id, task_id, due_date, kind)
SELECT workspace_id, id, due_date, 'DUE_REACHED'
FROM task
WHERE deleted_at IS NULL AND due_date IS NOT NULL AND due_date <= now();
