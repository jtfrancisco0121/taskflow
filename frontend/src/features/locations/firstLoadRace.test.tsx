import { describe, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { expectRestarted, put } from '../../test/firstLoadRace'
import { useMoveLocation } from './useLocationMutations'

const w = 'w1'
const tasksKey = queryKeys.tasks(w, 'l1')

describe('locations: a first list load in flight when the write lands (cancel before invalidate)', () => {
  it('useMoveLocation (move a List, paths change)', async () => {
    await expectRestarted(
      tasksKey,
      (wrote) => ({ 'POST /api/v1/locations/:id/move': put(wrote, { id: 'l1' }) }),
      () => useMoveLocation(w),
      (move) => move.mutateAsync({ id: 'l1', parentId: 'f1' }),
    )
  })
})
