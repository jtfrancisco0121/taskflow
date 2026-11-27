import { describe, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { problem } from '../../test/api'
import { expectRestarted, put } from '../../test/firstLoadRace'
import {
  useCreateAutomation,
  useDeleteAutomation,
  useToggleAutomation,
  useUpdateAutomation,
} from './useAutomations'

const key = queryKeys.automations('l1')
const rule = { id: 'r1', version: 2 }

describe('automations: a rule list on its first load when the write lands (cancel before invalidate)', () => {
  it('useCreateAutomation', async () => {
    await expectRestarted(
      key,
      (wrote) => ({ 'POST /api/v1/locations/:id/automations': put(wrote, rule) }),
      () => useCreateAutomation('l1'),
      (create) => create.mutateAsync({ name: 'Rule' } as never),
    )
  })

  it('useUpdateAutomation', async () => {
    await expectRestarted(
      key,
      (wrote) => ({ 'PATCH /api/v1/automations/:id': put(wrote, rule) }),
      () => useUpdateAutomation(),
      (update) => update.mutateAsync({ id: 'r1', version: 1, body: { name: 'R' } as never }),
    )
  })

  it('useUpdateAutomation on a 409 (the fresh list either way)', async () => {
    await expectRestarted(
      key,
      (wrote) => ({
        'PATCH /api/v1/automations/:id': () => {
          wrote()
          return problem(409, 'automation.version_conflict', 'Changed')
        },
      }),
      () => useUpdateAutomation(),
      (update) =>
        update.mutateAsync({ id: 'r1', version: 1, body: {} as never }).catch(() => undefined),
    )
  })

  it('useDeleteAutomation', async () => {
    await expectRestarted(
      key,
      (wrote) => ({ 'DELETE /api/v1/automations/:id': put(wrote, {}) }),
      () => useDeleteAutomation(),
      (remove) => remove.mutateAsync({ id: 'r1', version: 1 }),
    )
  })

  it('useToggleAutomation: a first load that starts after onMutate is restarted when it settles', async () => {
    await expectRestarted(
      key,
      (wrote) => ({ 'PATCH /api/v1/automations/:id': put(wrote, rule) }),
      () => useToggleAutomation('l1'),
      (toggle) => toggle.mutateAsync({ id: 'r1', version: 1, enabled: false }),
      { startDuringWrite: true },
    )
  })
})
