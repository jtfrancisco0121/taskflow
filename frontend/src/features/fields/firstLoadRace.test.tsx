import { describe, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { expectRestarted, put } from '../../test/firstLoadRace'
import { useCreateField } from './useFieldMutations'

const w = 'w1'
const viewKey = queryKeys.view(w, 'l1', 'h')

describe('fields: a first list load in flight when the write lands (cancel before invalidate)', () => {
  it('useCreateField (field definition change)', async () => {
    await expectRestarted(
      viewKey,
      (wrote) => ({ 'POST /api/v1/locations/:id/fields': put(wrote, { id: 'f1' }) }),
      () => useCreateField(w, 'l1'),
      (create) => create.mutateAsync({ name: 'Tier', type: 'TEXT' } as never),
    )
  })
})
