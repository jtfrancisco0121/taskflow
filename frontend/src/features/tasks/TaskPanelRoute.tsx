import { matchPath, useLocation, useNavigate, useParams } from 'react-router'
import { TaskPanel } from './TaskPanel'
import { useTask } from './useTask'
import type { TaskView } from '../../api/types'
import type { ReactNode } from 'react'

type RouterLocation = { pathname: string; search?: string }
type BackgroundState = { backgroundLocation?: RouterLocation }

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

  function close() {
    if (drawn) void navigate(`${drawn.pathname}${drawn.search ?? ''}`)
    else void navigate('/')
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-6">{drawn && background?.(drawn)}</div>
      {taskId && (
        <TaskPanel key={taskId} taskId={taskId} onClose={close}>
          {tabs}
        </TaskPanel>
      )}
    </div>
  )
}
