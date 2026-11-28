import { act, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import type { TaskView } from '../../api/types'
import { installFetch, json, problem, renderWithProviders } from '../../test/api'
import { CustomFieldsGroup } from './CustomFieldsGroup'

const task = {
  id: 't1',
  workspaceId: 'w1',
  listId: 'l1',
  readableId: 'ACME-1',
  customFields: {},
  version: 1,
} as TaskView

const points = {
  id: 'f1',
  name: 'Story points',
  type: 'NUMBER',
  config: { decimals: 0 },
  options: [],
  definedAt: 's1',
  definedAtName: 'Engineering',
  inherited: true,
  hidden: false,
  version: 1,
}

// 14yq6g334bn part 2: after a refresh that fails with 403 or 404 the fields are gone or hidden, so only the error
// shows; a 500 keeps the last fields under the Retry notice.
describe('CustomFieldsGroup after a failed refresh (14yq6g334bn)', () => {
  function failing(code: number) {
    let fail = false
    installFetch({
      'GET /api/v1/locations/:id/fields': () =>
        fail
          ? problem(code, 'x', 'No')
          : json({ locationId: 'l1', canEdit: true, fields: [points] }),
    } as never)
    const { queryClient } = renderWithProviders(
      <CustomFieldsGroup task={task} hints={{}} save={async () => true} />,
    )
    return () => {
      fail = true
      return act(() => queryClient.refetchQueries({ queryKey: queryKeys.fields('l1') }))
    }
  }

  it.each([403, 404])('a %i refresh shows the error and no stale field', async (code) => {
    const fail = failing(code)
    expect(await screen.findByText('Story points')).toBeVisible()
    await fail()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the custom fields")
    expect(screen.queryByText('Story points')).toBeNull()
    expect(screen.queryByRole('status', { name: 'Couldn’t refresh' })).toBeNull()
  })

  it('a 500 refresh keeps the field under the Retry notice', async () => {
    const fail = failing(500)
    expect(await screen.findByText('Story points')).toBeVisible()
    await fail()
    expect(await screen.findByRole('status', { name: 'Couldn’t refresh' })).toBeVisible()
    expect(screen.getByText('Story points')).toBeVisible()
  })
})
