import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FOCUSABLE } from './floating'

type DialogProps = {
  title: string
  onClose: () => void
  children: ReactNode
  /** Called on close when the element that opened the dialog is gone (for example a closed menu). */
  restoreFocus?: () => HTMLElement | null
  wide?: boolean
  /** `top`: the command-palette sheet (560px, 12vh from the top, hidden title, closes on a backdrop click). */
  placement?: 'center' | 'top'
}

/** A modal dialog: focus moves in, Tab is trapped, Escape closes, focus returns to the opener. */
export function Dialog({
  title,
  onClose,
  children,
  restoreFocus,
  wide,
  placement = 'center',
}: DialogProps) {
  const top = placement === 'top'
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
    <div
      className={`fixed inset-0 z-(--tf-z-dialog) flex justify-center bg-overlay p-4 ${top ? 'items-start pt-[12vh]' : 'items-center'}`}
      onMouseDown={top ? (event) => event.target === event.currentTarget && onClose() : undefined}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        {...(top ? { 'data-tf-floating': '', 'data-tf-palette': '' } : {})}
        className={`w-full overflow-auto rounded-xl glass ${
          top
            ? 'max-h-[80vh] max-w-[560px] p-2'
            : `max-h-[90vh] p-5 ${wide ? 'max-w-2xl' : 'max-w-md'}`
        }`}
      >
        <h2 id={titleId} className={top ? 'sr-only' : 'mb-3 font-display text-base font-semibold'}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  )
}
