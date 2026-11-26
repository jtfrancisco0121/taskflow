import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { isShortcutBlocked } from '../../shared/ui/shortcutGuard'
import { useUiStore } from '../../shared/ui-store'

/**
 * AD-5, AD-9: Cmd+K / Ctrl+K toggles the palette, also inside inputs and the editor. It does nothing (no toggle,
 * no preventDefault) while another modal dialog is open (it must never unmount a one-time key or an unsaved form)
 * or while a floating layer is open (a modal menu, Select or popover traps focus and the pointer).
 *
 * Before the shell is ready (session boot, shell mounting) the key is queued as `paletteRequested` and the palette
 * opens once when the shell is ready. A queued request is dropped on a route change and on unmount, so it never
 * opens the palette later, unasked. `enabled` lets RequireSession listen during the boot, then hand over to the
 * palette's own listener.
 */
export function useShortcut(enabled = true) {
  useEffect(() => {
    if (!enabled) return
    function onKey(event: KeyboardEvent) {
      if (event.key?.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return
      if (event.altKey || event.shiftKey) return
      if (isShortcutBlocked(event, { allowInTextFields: true, singleKey: false })) return
      event.preventDefault()
      const state = useUiStore.getState()
      if (state.shellReady) state.togglePalette()
      else state.setPaletteRequested(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled])

  const key = useLocation().key
  const first = useRef(true)
  useEffect(() => {
    if (first.current) first.current = false
    else useUiStore.getState().setPaletteRequested(false)
  }, [key])
  useEffect(() => () => useUiStore.getState().setPaletteRequested(false), [])
}
