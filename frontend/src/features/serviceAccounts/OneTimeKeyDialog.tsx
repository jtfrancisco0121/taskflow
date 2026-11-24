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
        className="mb-3 rounded border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900"
      >
        This key will not be shown again. Copy it now and store it in a secret manager.
      </p>
      <div className="mb-2 flex items-center gap-2 rounded border border-slate-300 bg-slate-100 p-2">
        <code
          aria-label="API key"
          className="flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap select-all"
        >
          {secret}
        </code>
        <Button variant="primary" onClick={() => void copy()}>
          Copy
        </Button>
      </div>
      <p aria-live="polite" className="mb-4 h-5 text-sm text-green-700">
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
