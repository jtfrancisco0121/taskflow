import { matchPath, useLocation, useNavigate, useParams } from 'react-router'
import { TaskPanel } from './TaskPanel'
import { useTask } from './useTask'
import type { TaskView } from '../../api/types'
import type { ReactNode } from 'react'

type RouterLocation = { pathname: string; search?: string }
type BackgroundState = { backgroundLocation?: RouterLocation }

/**
 * Focuses the row of a task once the view behind has it. It waits for the detail to be gone (the navigation is
 * committed and the Dialog has given focus back to its opener, and the view has mounted its own quick-add focus),
 * and gives up when another task was opened meanwhile (it owns the focus then).
 */
function focusRowOf(id: string) {
  // Anything the person does after the close owns the focus from then on: stop at their first press or key.
  let cancelled = false
  const stop = () => {
    cancelled = true
    document.removeEventListener('pointerdown', stop, true)
    document.removeEventListener('keydown', stop, true)
  }
  document.addEventListener('pointerdown', stop, true)
  document.addEventListener('keydown', stop, true)
  poll(id, 40, () => cancelled, stop)
}

function poll(id: string, attempts: number, isCancelled: () => boolean, done: () => void) {
  setTimeout(() => {
    if (isCancelled()) return
    const path = window.location.pathname
    if (path.startsWith('/t/') && path !== `/t/${id}`) return done()
    const detailOpen = document.querySelector(
      '[role="dialog"][aria-modal="true"], [role="complementary"][aria-label^="Task "]',
    )
    const row = detailOpen
      ? null
      : document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`)
    if (row) {
      row.focus()
      done()
    } else if (attempts > 0) poll(id, attempts - 1, isCancelled, done)
    else done()
  }, 50)
}

/**
 * `/t/:taskId` (AD-3): the Task panel over a view. The view behind is the one the user came from
 * (router state, with its URL parameters), or, opened cold, the task's home List. The router
 * supplies how a location is drawn (`background`), so this feature never imports the views.
 */
export function TaskPanelRoute({
  tabs,
  background,
}: {
  tabs?: (task: TaskView) => ReactNode
  background?: (location: RouterLocation) => ReactNode
}) {
  const { taskId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const task = useTask(taskId).data
  const behind = (location.state as BackgroundState | null)?.backgroundLocation
  const from = matchPath('/w/:workspaceId/*', behind?.pathname ?? '')

  const workspaceId = from?.params.workspaceId ?? task?.workspaceId
  const homeList = task?.listId
  const drawn: RouterLocation | null =
    behind ?? (workspaceId && homeList ? { pathname: `/w/${workspaceId}/l/${homeList}` } : null)

  // The task the detail last showed: after a j/k switch it is the row to land on, not the one that opened it.
  function close() {
    if (drawn) void navigate(`${drawn.pathname}${drawn.search ?? ''}`)
    else void navigate('/')
    if (taskId) focusRowOf(taskId)
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-6">{drawn && background?.(drawn)}</div>
      {taskId && (
        <TaskPanel taskId={taskId} onClose={close}>
          {tabs}
        </TaskPanel>
      )}
    </div>
  )
}
