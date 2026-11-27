import { describe, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { expectRestarted, put } from '../../test/firstLoadRace'
import { useReplaceStatuses, useResetStatuses } from './useStatusMutations'

const w = 'w1'
const viewKey = queryKeys.view(w, 'l1', 'h')

describe('statuses: a first list load in flight when the write lands (cancel before invalidate)', () => {
  it('useReplaceStatuses (status set write)', async () => {
    await expectRestarted(
      viewKey,
      (wrote) => ({ 'PUT /api/v1/locations/:id/statuses': put(wrote, { statuses: [] }) }),
      () => useReplaceStatuses(w, 'l1'),
      (replace) => replace.mutateAsync({ statuses: [] } as never),
    )
  })

  it('useResetStatuses (status set reset)', async () => {
    await expectRestarted(
      viewKey,
      (wrote) => ({ 'DELETE /api/v1/locations/:id/statuses': put(wrote, { statuses: [] }) }),
      () => useResetStatuses(w, 'l1'),
      (reset) => reset.mutateAsync([]),
    )
  })
})
