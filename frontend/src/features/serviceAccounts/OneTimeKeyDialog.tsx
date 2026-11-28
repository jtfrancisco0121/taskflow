import { useEffect, useRef, useState } from 'react'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'

type Props = {
  keyName: string
  secret: string
  onDone: () => void
}

/**
 * The only place a key secret is shown (KEY-1). Escape and the backdrop do nothing; the one way
 * out is the button, after which the caller drops the secret.
 */
export function OneTimeKeyDialog({ keyName, secret, onDone }: Props) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // The text is selectable, so a failed clipboard write is not a dead end.
    }
  }

  return (
    <Dialog title={`Key ${keyName} created`} onClose={() => undefined}>
      <p
        role="note"
        className="mb-3 rounded-md border border-line-strong bg-warn-soft p-3 text-[13px] text-fg"
      >
        This key will not be shown again. Copy it now and store it in a secret manager.
      </p>
      <div className="mb-2 flex items-center gap-2 rounded-md border border-line-strong bg-surface-2 p-2">
        {/* data-secret: the e2e screenshots mask this element, so no image ever carries a key. */}
        <code
          aria-label="API key"
          data-secret=""
          className="flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap select-all"
        >
          {secret}
        </code>
        <Button variant="primary" onClick={() => void copy()}>
          Copy
        </Button>
      </div>
      <p aria-live="polite" className="mb-4 h-5 text-[13px] text-muted">
        {copied ? 'Key copied' : ''}
      </p>
      <div className="flex justify-end">
        <Button variant="primary" onClick={onDone}>
          I have copied the key
        </Button>
      </div>
    </Dialog>
  )
}
