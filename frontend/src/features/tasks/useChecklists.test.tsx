import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { installFetch, json, newQueryClient, problem } from '../../test/api'
import { useChecklists, useChecklistWrites, type Checklist } from './useChecklists'

const list = (items: object[] = [], name = 'Release'): Checklist =>
  ({ id: 'k1', taskId: 't1', name, items }) as Checklist
const item = (id: string, text: string, checked = false) => ({ id, text, checked })

function setup(initial: Checklist[], routes: Record<string, unknown> = {}) {
  const stub = installFetch({
    'GET /api/v1/tasks/:id/checklists': json(initial),
    ...routes,
  } as never)
  const queryClient = newQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => ({ q: useChecklists('t1'), writes: useChecklistWrites('t1') }), {
    wrapper,
  })
  const cached = () => queryClient.getQueryData<Checklist[]>(queryKeys.checklists('t1'))
  return { stub, hook, cached, queryClient }
}

describe('useChecklists (CAP-8)', () => {
  it('replaces the checklist with the whole view each write returns', async () => {
    const { hook, cached } = setup([list([item('i1', 'One')])], {
      'POST /api/v1/checklists/:id/items': json(list([item('i1', 'One'), item('i2', 'Two')])),
    })
    await waitFor(() => expect(hook.result.current.q.isSuccess).toBe(true))
    let message: string | null = 'unset'
    await act(async () => {
      message = await hook.result.current.writes.addItem(cached()![0], 'Two')
    })
    expect(message).toBeNull()
    expect(cached()![0].items).toHaveLength(2)
  })

  it('removes a deleted checklist from the cache', async () => {
    const { hook, cached } = setup([list()], {
      'DELETE /api/v1/checklists/:id': new Response(null, { status: 200 }),
    })
    await waitFor(() => expect(hook.result.current.q.isSuccess).toBe(true))
    await act(async () => {
      await hook.result.current.writes.remove(cached()![0])
    })
    expect(cached()).toEqual([])
  })

  it('serializes writes on one checklist', async () => {
    const order: string[] = []
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const { hook, cached } = setup([list([item('i1', 'One')])], {
      'PATCH /api/v1/checklist-items/:id': async (_r: Request, body: unknown) => {
        order.push(`start ${JSON.stringify(body)}`)
        if (order.length === 1) await held
        order.push('end')
        return json(list([item('i1', 'One', true)]))
      },
    })
    await waitFor(() => expect(hook.result.current.q.isSuccess).toBe(true))
    const c = cached()![0]
    let both: Promise<unknown>
    act(() => {
      const w = hook.result.current.writes
      both = Promise.all([
        w.editItem(c, c.items![0], { checked: true }),
        w.editItem(c, c.items![0], { checked: false }),
      ])
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(order).toEqual(['start {"checked":true}'])
    release()
    await act(async () => {
      await both
    })
    expect(order).toEqual(['start {"checked":true}', 'end', 'start {"checked":false}', 'end'])
  })

  it('restores the previous entry and returns the server message on a refusal', async () => {
    const { hook, cached } = setup([list([item('i1', 'One')])], {
      'PATCH /api/v1/checklist-items/:id': problem(400, 'checklist.invalid', 'Too long'),
    })
    await waitFor(() => expect(hook.result.current.q.isSuccess).toBe(true))
    const c = cached()![0]
    let message: string | null = null
    await act(async () => {
      message = await hook.result.current.writes.editItem(c, c.items![0], { checked: true })
    })
    expect(message).toBe('Too long')
    expect(cached()![0].items![0].checked).toBe(false)
  })
})
