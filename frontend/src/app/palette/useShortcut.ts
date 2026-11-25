import { useEffect } from 'react'
import { hasOpenFloatingLayer } from '../../shared/ui/floating'

/**
 * AD-5: Cmd+K / Ctrl+K toggles the palette, also inside inputs and the editor. It does nothing (no toggle, no
 * preventDefault) while another modal dialog is open (it must never unmount a one-time key or an unsaved form)
 * or while a floating layer is open (a modal menu, Select or popover traps focus and the pointer).
 */
export function useShortcut(toggle: () => void) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return
      if (event.altKey || event.shiftKey) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]:not([data-tf-palette])'))
        return
      if (hasOpenFloatingLayer()) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [toggle])
}
