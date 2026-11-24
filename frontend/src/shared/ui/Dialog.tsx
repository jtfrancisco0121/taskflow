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

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`max-h-[90vh] w-full overflow-auto rounded-lg bg-white p-5 shadow-xl ${wide ? 'max-w-2xl' : 'max-w-md'}`}
      >
        <h2 id={titleId} className="mb-3 text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  )
}
