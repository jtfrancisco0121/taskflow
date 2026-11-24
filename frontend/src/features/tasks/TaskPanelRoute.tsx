import { matchPath, useLocation, useNavigate, useParams } from 'react-router'
import { TaskPanel } from './TaskPanel'
import { ListView } from './ListViewPage'
import { useTask } from './useTask'
import type { TaskView } from '../../api/types'
import type { ReactNode } from 'react'

type BackgroundState = { backgroundLocation?: { pathname: string; search?: string } }

/**
 * `/t/:taskId` (AD-3): the Task panel over a List view. The view behind is the Location the user
 * came from (router state), or, opened cold, the task's home List.
 */
export function TaskPanelRoute({ tabs }: { tabs?: (task: TaskView) => ReactNode }) {
  const { taskId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const task = useTask(taskId).data
  const background = (location.state as BackgroundState | null)?.backgroundLocation
  const from = matchPath('/w/:workspaceId/l/:locationId', background?.pathname ?? '')

  const workspaceId = from?.params.workspaceId ?? task?.workspaceId
  const locationId = from?.params.locationId ?? task?.listId

  function close() {
    if (background) void navigate(`${background.pathname}${background.search ?? ''}`)
    else if (workspaceId && locationId) void navigate(`/w/${workspaceId}/l/${locationId}`)
    else void navigate('/')
  }

  return (
    <div className="-m-6 flex min-h-[calc(100vh-3.5rem)]">
      <div className="min-w-0 flex-1 p-6">
        {workspaceId && locationId && (
          <ListView
            key={locationId}
            workspaceId={workspaceId}
            locationId={locationId}
            focusQuickAdd={false}
          />
        )}
      </div>
      {taskId && (
        <TaskPanel key={taskId} taskId={taskId} onClose={close}>
          {tabs}
        </TaskPanel>
      )}
    </div>
  )
}
