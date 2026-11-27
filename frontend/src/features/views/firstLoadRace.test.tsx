import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView } from '../../api/types'
import { useToastStore } from '../../shared/toast-store'
import { expectRestarted, put } from '../../test/firstLoadRace'
import { task } from './testSupport'
import { useTrashTasks } from './useTrashTasks'
import { useDeleteView, useSaveView } from './useViews'

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
  const scope = { workspaceId: w, locationId: 'l1' }
  const viewListKey = queryKeys.viewList(w, 'l1')

  it('useSaveView (a new view, the view list on its first load)', async () => {
    await expectRestarted(
      viewListKey,
      (wrote) => ({ 'POST /api/v1/views': put(wrote, { id: 'v1' }) }),
      () => useSaveView(scope),
      (save) => save.mutateAsync({ mode: 'create', type: 'LIST', config: {} as never }),
    )
  })

  it('useDeleteView (the view list on its first load)', async () => {
    await expectRestarted(
      viewListKey,
      (wrote) => ({
        'DELETE /api/v1/views/:id': () => {
          wrote()
          return new Response(null, { status: 204 })
        },
      }),
      () => useDeleteView(scope),
      (remove) => remove.mutateAsync({ id: 'v1' } as never),
    )
  })
})
