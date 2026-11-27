import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView } from '../../api/types'
import { useToastStore } from '../../shared/toast-store'
import { expectRestarted } from '../../test/firstLoadRace'
import { task } from './testSupport'
import { useTrashTasks } from './useTrashTasks'

const w = 'w1'
const viewKey = queryKeys.view(w, 'l1', 'h')
const taskView = task(1) as unknown as TaskView

describe('views: a first list load in flight when the write lands (cancel before invalidate)', () => {
  it('useTrashTasks (delete)', async () => {
    await expectRestarted(
      viewKey,
      (wrote) => ({
        'DELETE /api/v1/tasks/:id': () => {
          wrote()
          return new Response(null, { status: 204 })
        },
      }),
      () => useTrashTasks({ workspaceId: w, locationId: 'l1' }),
      ({ trash }) => trash([taskView]),
    )
  })

  it('useTrashTasks shows the Undo toast without waiting for the refetch', async () => {
    useToastStore.setState({ toasts: [] })
    await expectRestarted(
      viewKey,
      (wrote) => ({
        'DELETE /api/v1/tasks/:id': () => {
          wrote()
          return new Response(null, { status: 204 })
        },
      }),
      () => useTrashTasks({ workspaceId: w, locationId: 'l1' }),
      ({ trash }) => trash([taskView]),
      {
        holdRefetch: true,
        check: () =>
          expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
            'Moved 1 task to trash.',
          ),
      },
    )
  })
})
