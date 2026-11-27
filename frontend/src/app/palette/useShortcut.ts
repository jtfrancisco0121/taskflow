import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router'
import { isShortcutBlocked } from '../../shared/ui/shortcutGuard'
import { useUiStore } from '../../shared/ui-store'

/**
 * AD-5, AD-9: Cmd+K / Ctrl+K toggles the palette, also inside inputs and the editor. It does nothing (no toggle,
 * no preventDefault) while another modal dialog is open (it must never unmount a one-time key or an unsaved form)
 * or while a floating layer is open (a modal menu, Select or popover traps focus and the pointer).
 *
 * Before the shell is ready (session boot, shell mounting) the key is queued as `paletteRequested` and the palette
 * opens once when the shell is ready. A queued request is dropped on a user's route change and on unmount, so it never
 * opens the palette later, unasked. A route change drops it only when the user made it (a push or a back/forward);
 * a replace (a redirect during the boot) keeps it. `enabled` lets RequireSession listen during the boot, then hand over to the
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

  // Both drops are safe under StrictMode's effect replay (mount, unmount, mount again in one task): a route change
  // is a key different from the one seen before, and an unmount counts only if no consumer mounts after it in the
  // same task (the replay, or the next consumer taking over).
  const location = useLocation()
  const navigationType = useNavigationType()
  const seenKey = useRef(location.key)
  useEffect(() => {
    if (seenKey.current === location.key) return
    seenKey.current = location.key
    if (navigationType !== 'REPLACE') useUiStore.getState().setPaletteRequested(false)
  }, [location.key, navigationType])
  useEffect(() => {
    mountCount += 1
    return () => {
      const seen = mountCount
      queueMicrotask(() => {
        if (mountCount === seen) useUiStore.getState().setPaletteRequested(false)
      })
    }
  }, [])
}

/** Counts every mount of the hook, so an unmount can tell whether another consumer mounted right after it. */
let mountCount = 0
