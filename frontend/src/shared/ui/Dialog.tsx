import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type DialogProps = {
  title: string
  onClose: () => void
  children: ReactNode
  /** Called on close when the element that opened the dialog is gone (for example a closed menu). */
  restoreFocus?: () => HTMLElement | null
  wide?: boolean
}

// Skips aria-hidden and tabindex=-1 elements (AD-12): Radix renders a hidden form <select> next to its trigger.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
]
  .map((selector) => `${selector}:not([aria-hidden="true"]):not([tabindex="-1"])`)
  .join(',')

/** A modal dialog: focus moves in, Tab is trapped, Escape closes, focus returns to the opener. */
export function Dialog({ title, onClose, children, restoreFocus, wide }: DialogProps) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const restoreRef = useRef(restoreFocus)

  useEffect(() => {
    restoreRef.current = restoreFocus
  })

  useEffect(() => {
    const opener = document.activeElement
    const node = ref.current
    const first = node?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? node)?.focus()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
      else restoreRef.current?.()?.focus()
    }
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Events from a portalled floating layer (a Select, a menu) bubble here through the React tree (AD-12).
    if (event.defaultPrevented || !ref.current?.contains(event.target as Node)) return
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-(--tf-z-dialog) flex items-center justify-center bg-overlay p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`max-h-[90vh] w-full overflow-auto rounded-xl p-5 glass ${wide ? 'max-w-2xl' : 'max-w-md'}`}
      >
        <h2 id={titleId} className="mb-3 font-display text-base font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  )
}
