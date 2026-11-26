import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
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
  /**
   * `task`: the task detail frame (up to 940px wide, 88vh, no inner padding, hidden title, no backdrop close).
   * The content lays itself out; the title stays the dialog's accessible name.
   */
  size?: 'task'
  /** The element that gets focus on open, instead of the first focusable one. */
  initialFocus?: RefObject<HTMLElement | null>
  /**
   * Asked for every Escape that reaches the dialog. Returning false leaves that Escape alone: the dialog stays
   * open and the event is not stopped (an editor inside, such as a comment composer, owns it).
   */
  closeOnEscape?: (event: KeyboardEvent<HTMLDivElement>) => boolean
}

/** A modal dialog: focus moves in, Tab is trapped, Escape closes, focus returns to the opener. */
export function Dialog({
  title,
  onClose,
  children,
  restoreFocus,
  wide,
  placement = 'center',
  size,
  initialFocus,
  closeOnEscape,
}: DialogProps) {
  const top = placement === 'top'
  const task = size === 'task'
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const restoreRef = useRef(restoreFocus)

  useEffect(() => {
    restoreRef.current = restoreFocus
  })

  useEffect(() => {
    const opener = document.activeElement
    const node = ref.current
    const first = initialFocus?.current ?? node?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? node)?.focus()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
      else restoreRef.current?.()?.focus()
    }
    // Focus moves in once, when the dialog opens: a later change of `initialFocus` must not move it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Events from a portalled floating layer (a Select, a menu) bubble here through the React tree (AD-12).
    if (event.defaultPrevented || !ref.current?.contains(event.target as Node)) return
    if (event.key === 'Escape') {
      if (closeOnEscape && !closeOnEscape(event)) return
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
        className={`w-full rounded-xl glass ${
          task
            ? 'flex h-[88vh] max-w-[940px] flex-col overflow-hidden'
            : top
              ? 'max-h-[80vh] max-w-[560px] overflow-auto p-2'
              : `max-h-[90vh] overflow-auto p-5 ${wide ? 'max-w-2xl' : 'max-w-md'}`
        }`}
      >
        <h2
          id={titleId}
          className={top || task ? 'sr-only' : 'mb-3 font-display text-base font-semibold'}
        >
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  )
}
