const LETTER = { SPACE: 'S', FOLDER: 'F', LIST: 'L' } as const
const COLOR = {
  SPACE: 'bg-violet-100 text-violet-800',
  FOLDER: 'bg-amber-100 text-amber-800',
  LIST: 'bg-sky-100 text-sky-800',
} as const

export type LocationType = keyof typeof LETTER

/** Type icon: a letter badge (decorative; the node name and type carry the meaning). */
export function LocationIcon({ type }: { type: LocationType | undefined }) {
  const t = type ?? 'LIST'
  return (
    <span
      aria-hidden="true"
      data-icon={t}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs font-bold ${COLOR[t]}`}
    >
      {LETTER[t]}
    </span>
  )
}

export function LockMarker() {
  return (
    <span role="img" aria-label="Private" title="Private" className="text-xs text-slate-500">
      🔒
    </span>
  )
}
