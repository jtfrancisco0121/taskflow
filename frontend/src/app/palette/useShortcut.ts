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
  const mounted = useRef(true)
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

  // Both drops are safe under StrictMode's effect replay (mount, unmount, mount again in one task): a route change
  // is a key different from the one seen before, and an unmount counts only if no remount follows at once.
  const key = useLocation().key
  const seenKey = useRef(key)
  useEffect(() => {
    if (seenKey.current === key) return
    seenKey.current = key
    useUiStore.getState().setPaletteRequested(false)
  }, [key])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      queueMicrotask(() => {
        if (!mounted.current) useUiStore.getState().setPaletteRequested(false)
      })
    }
  }, [])
}
