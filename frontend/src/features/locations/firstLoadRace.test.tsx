import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { queryKeys } from '../../api/queryKeys'
import { useUiStore } from '../../shared/ui-store'
import { installFetch, json, newQueryClient } from '../../test/api'
import { expectRestarted, put } from '../../test/firstLoadRace'
import { useCreateLocation, useMoveLocation, useUpdateLocation } from './useLocationMutations'

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
  it('useCreateLocation (the sidebar tree on its first load)', async () => {
    await expectRestarted(
      queryKeys.tree(w, 'root'),
      (wrote) => ({ 'POST /api/v1/locations': put(wrote, { id: 's1' }) }),
      () => useCreateLocation(w),
      (create) => create.mutateAsync({ name: 'Space', type: 'SPACE' }),
    )
  })
  const rename = (wrote: () => void) => ({
    'PATCH /api/v1/locations/:id': put(wrote, { id: 'l1', name: 'Renamed' }),
  })
  it('useUpdateLocation restarts the parent tree list on its first load (the rename updater has no list yet)', async () => {
    await expectRestarted(
      queryKeys.tree(w, 'root'),
      rename,
      () => useUpdateLocation(w),
      (update) => update.mutateAsync({ id: 'l1', name: 'Renamed' }),
    )
  })
  it('useUpdateLocation restarts the location on its first load (its late load would overwrite the response)', async () => {
    await expectRestarted(
      queryKeys.location('l1'),
      rename,
      () => useUpdateLocation(w),
      (update) => update.mutateAsync({ id: 'l1', name: 'Renamed' }),
    )
  })
})

describe('locations: expand state around the post-create tree refresh', () => {
  it('a parent the user collapses while the tree refreshes stays collapsed; the new Folder still opens', async () => {
    const ws = 'w-collapse'
    installFetch({ 'POST /api/v1/locations': json({ id: 'f9', type: 'FOLDER' }) })
    let reads = 0
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const queryClient = newQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    )
    const { result } = renderHook(
      () => ({
        tree: useQuery({
          queryKey: queryKeys.tree(ws, 'root'),
          queryFn: async () => {
            reads += 1
            if (reads > 1) await held // the post-create refresh is still in flight
            return []
          },
        }),
        create: useCreateLocation(ws),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.tree.data).toEqual([]))
    let firing: Promise<unknown> = Promise.resolve()
    act(() => {
      firing = result.current.create.mutateAsync({ name: 'Brand', type: 'FOLDER', parentId: 's1' })
    })
    await waitFor(() => expect(reads).toBe(2))
    act(() => useUiStore.getState().setExpanded(ws, 's1', false)) // the user collapses the parent
    release()
    await act(() => firing)
    const expanded = useUiStore.getState().expanded[ws] ?? []
    expect(expanded).not.toContain('s1')
    expect(expanded).toContain('f9') // FR-11: the new Folder opens to show its first List
  })
})
