import { useState } from 'react'
import { messageOf } from '../../api/errors'
import type { CommentView, TaskView } from '../../api/types'
import { formatDateTime, relativeTime } from '../../shared/dates'
import { isEmptyDoc, RichTextEditor, RichTextView, type RichDoc } from '../../shared/richtext'
import { useToastStore } from '../../shared/toast-store'
import { AutomationBadge } from '../../shared/ui/AutomationBadge'
import { Button } from '../../shared/ui/Button'
import { useSession } from '../auth'
import { useMembers } from '../workspace'
import { useComments, useCreateComment, useDeleteComment, useEditComment } from './useComments'

/** FR-19, FR-20: comments oldest first with a composer; the author can edit and delete. */
export function CommentsTab({ task }: { task: TaskView }) {
  const taskId = task.id!
  const comments = useComments(taskId)
  const { members } = useMembers(task.workspaceId)
  const mentionable = members.map((m) => ({ id: m.userId!, name: m.displayName ?? m.email ?? '' }))
  const me = useSession().user?.id
  const items = [
    ...new Map(
      (comments.data?.pages.flatMap((page) => page.items ?? []) ?? []).map((c) => [c.id, c]),
    ).values(),
  ]

  return (
    <div className="flex flex-col gap-3">
      {comments.isPending && <p role="status">Loading…</p>}
      {comments.isError && (
        <p role="alert" className="text-sm text-red-700">
          {messageOf(comments.error)}
        </p>
      )}
      {comments.isSuccess && items.length === 0 && (
        <p className="text-sm text-slate-600">No comments yet.</p>
      )}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {items.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            taskId={taskId}
            mine={!!me && comment.authorId === me}
            members={mentionable}
          />
        ))}
      </ul>
      {comments.hasNextPage && (
        <Button
          disabled={comments.isFetchingNextPage}
          onClick={() => void comments.fetchNextPage()}
        >
          Show more
        </Button>
      )}
      <Composer taskId={taskId} members={mentionable} />
    </div>
  )
}

function Composer({
  taskId,
  members,
}: {
  taskId: string
  members: { id: string; name: string }[]
}) {
  const [doc, setDoc] = useState<RichDoc | null>(null)
  const [generation, setGeneration] = useState(0)
  const create = useCreateComment(taskId)
  const showToast = useToastStore((state) => state.show)
  const empty = isEmptyDoc(doc)

  function submit() {
    if (!doc || isEmptyDoc(doc) || create.isPending) return
    create.mutate(doc, {
      onSuccess: () => {
        setDoc(null)
        setGeneration((n) => n + 1) // a fresh, empty editor
      },
      // The text stays in the composer so nothing is lost.
      onError: (error) => showToast(messageOf(error), 'error'),
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <RichTextEditor
        key={generation}
        label="Write a comment"
        members={members}
        value={null}
        onChange={setDoc}
        onSubmit={submit}
      />
      <div className="flex justify-end">
        <Button variant="primary" disabled={empty || create.isPending} onClick={submit}>
          Comment
        </Button>
      </div>
    </div>
  )
}

function CommentItem({
  comment,
  taskId,
  mine,
  members,
}: {
  comment: CommentView
  taskId: string
  mine: boolean
  members: { id: string; name: string }[]
}) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [draft, setDraft] = useState<RichDoc | null>(null)
  const edit = useEditComment(taskId)
  const remove = useDeleteComment(taskId)
  const body = comment.body as RichDoc | undefined

  return (
    <li className="flex flex-col gap-1 rounded border border-slate-200 p-2">
      <div className="flex items-baseline gap-2 text-xs text-slate-600">
        <span className="font-medium text-slate-900">{comment.authorName}</span>
        {comment.authorIsAutomation && <AutomationBadge />}
        <time dateTime={comment.createdAt} title={formatDateTime(comment.createdAt)}>
          {relativeTime(comment.createdAt)}
        </time>
        {comment.editedAt && <span title={formatDateTime(comment.editedAt)}>edited</span>}
        {mine && !editing && (
          <span className="ml-auto flex gap-2">
            <button type="button" className="underline" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" className="underline" onClick={() => setConfirming(true)}>
              Delete
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <RichTextEditor label="Edit comment" members={members} value={body} onChange={setDraft} />
          {edit.isError && (
            <p role="alert" className="text-sm text-red-700">
              {messageOf(edit.error)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={edit.isPending}
              onClick={() => {
                if (!draft || isEmptyDoc(draft)) return setEditing(false)
                edit.mutate(
                  { id: comment.id!, body: draft },
                  { onSuccess: () => setEditing(false) },
                )
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <RichTextView doc={body} label="Comment" />
      )}
      {confirming && (
        <div
          role="alertdialog"
          aria-label="Delete this comment?"
          className="flex items-center gap-2 text-sm"
        >
          <span>Delete this comment?</span>
          <Button
            variant="danger"
            disabled={remove.isPending}
            onClick={() => remove.mutate(comment.id!, { onSuccess: () => setConfirming(false) })}
          >
            Confirm delete
          </Button>
          <Button onClick={() => setConfirming(false)}>Keep</Button>
          {remove.isError && (
            <span role="alert" className="text-red-700">
              {messageOf(remove.error)}
            </span>
          )}
        </div>
      )}
    </li>
  )
}
