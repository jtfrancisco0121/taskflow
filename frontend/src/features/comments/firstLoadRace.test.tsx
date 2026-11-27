import { describe, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { expectRestarted, put } from '../../test/firstLoadRace'
import { useCreateComment, useDeleteComment } from './useComments'

const doc = { type: 'doc', content: [] } as never

describe('comments: a first load in flight when the write lands (cancel before invalidate)', () => {
  it('useCreateComment restarts the comment list', async () => {
    await expectRestarted(
      queryKeys.comments('t1'),
      (wrote) => ({ 'POST /api/v1/tasks/:id/comments': put(wrote, { id: 'c1' }) }),
      () => useCreateComment('t1'),
      (create) => create.mutateAsync(doc),
    )
  })

  it('useCreateComment restarts the activity log', async () => {
    await expectRestarted(
      queryKeys.activity('t1'),
      (wrote) => ({ 'POST /api/v1/tasks/:id/comments': put(wrote, { id: 'c1' }) }),
      () => useCreateComment('t1'),
      (create) => create.mutateAsync(doc),
    )
  })

  it('useDeleteComment restarts the comment list', async () => {
    await expectRestarted(
      queryKeys.comments('t1'),
      (wrote) => ({
        'DELETE /api/v1/comments/:id': () => {
          wrote()
          return new Response(null, { status: 204 })
        },
      }),
      () => useDeleteComment('t1'),
      (remove) => remove.mutateAsync('c1'),
    )
  })
})
