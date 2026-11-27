import { describe, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { expectRestarted, put } from '../../test/firstLoadRace'
import { useCreateField, useRetireField, useUpdateField } from './useFieldMutations'

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

  it('useUpdateField (field edit)', async () => {
    await expectRestarted(
      viewKey,
      (wrote) => ({ 'PATCH /api/v1/fields/:id': put(wrote, { id: 'f1' }) }),
      () => useUpdateField(w),
      (update) => update.mutateAsync({ id: 'f1', version: 1, body: { name: 'Tier 2' } as never }),
    )
  })

  it('useRetireField (field delete)', async () => {
    await expectRestarted(
      viewKey,
      (wrote) => ({ 'DELETE /api/v1/fields/:id': put(wrote, {}) }),
      () => useRetireField(w),
      (retire) => retire.mutateAsync({ id: 'f1', version: 1 }),
    )
  })
})
