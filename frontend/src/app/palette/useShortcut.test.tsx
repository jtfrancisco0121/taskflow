import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { useUiStore } from '../../shared/ui-store'
import { renderWithProviders } from '../../test/api'
import { useShortcut } from './useShortcut'

function Consumer() {
  useShortcut(false)
  return null
}

function Swap() {
  const [second, setSecond] = useState(false)
  return (
    <>
      {second ? <Consumer key="b" /> : <Consumer key="a" />}
      <button onClick={() => setSecond(true)}>swap</button>
    </>
  )
}

describe('useShortcut queued request and consumers', () => {
  it('keeps a queued request when one consumer unmounts as another mounts in the same task', async () => {
    renderWithProviders(<Swap />)
    act(() => useUiStore.getState().setPaletteRequested(true))
    await userEvent.setup().click(screen.getByRole('button', { name: 'swap' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(useUiStore.getState().paletteRequested).toBe(true)
  })

  it('drops a queued request when the last consumer unmounts', async () => {
    const view = renderWithProviders(<Consumer />)
    act(() => useUiStore.getState().setPaletteRequested(true))
    view.unmount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(useUiStore.getState().paletteRequested).toBe(false)
  })
})
