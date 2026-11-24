import { Button } from '../../shared/ui/Button'

export type ConflictChange = { field: string; label: string; text: string }

type ConflictBannerProps = {
  changes: ConflictChange[]
  onApply: () => void
  onDiscard: () => void
  applying?: boolean
}

/** FR-18: the server's version is shown; the user's attempted change is kept until they decide. */
export function ConflictBanner({ changes, onApply, onDiscard, applying }: ConflictBannerProps) {
  return (
    <div role="alert" className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-medium">Someone else changed this task. Their version is shown.</p>
      <ul className="mt-2 flex flex-col gap-1">
        {changes.map((change) => (
          <li key={change.field}>
            <span className="text-slate-700">{change.label}: </span>
            <span>Your change: {change.text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <Button variant="primary" disabled={applying} onClick={onApply}>
          Apply again
        </Button>
        <Button onClick={onDiscard}>Discard</Button>
      </div>
    </div>
  )
}
