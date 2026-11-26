import { useEffect, useState } from 'react'
import { SHORTCUTS, type Shortcut } from '../../shared/shortcuts'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { Kbd } from '../../shared/ui/Kbd'
import { isShortcutBlocked } from '../../shared/ui/shortcutGuard'

const GROUPS: Shortcut['group'][] = ['Global', 'List']

/** The `?` sheet (AD-9): every shortcut from SHORTCUTS. It never opens in a text field, under a modal or a layer. */
export function ShortcutSheet() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== '?' || isShortcutBlocked(event)) return
      event.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!open) return null
  return (
    <Dialog title="Keyboard shortcuts" onClose={() => setOpen(false)}>
      <div className="flex flex-col gap-4">
        {GROUPS.map((group) => (
          <section key={group} aria-label={group}>
            <h3 className="mb-1 text-xs font-medium text-muted uppercase">{group}</h3>
            <ul className="flex flex-col gap-1">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <li key={s.description} className="flex items-center gap-3 text-[13px] text-fg">
                  <span className="flex-1">{s.description}</span>
                  <span className="flex gap-1">
                    {s.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={() => setOpen(false)}>Close</Button>
      </div>
    </Dialog>
  )
}
