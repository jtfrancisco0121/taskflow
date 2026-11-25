type StatusPillProps = {
  name: string
  color?: string | null
}

/** Status name with a color dot; the name is always there, color is never the only signal. */
export function StatusPill({ name, color }: StatusPillProps) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-xs">
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${color ? '' : 'bg-status-todo'}`}
        style={color ? { backgroundColor: color } : undefined}
      />
      {name}
    </span>
  )
}
