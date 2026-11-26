import { OPTION_COLORS } from './fieldTypes'

type OptionChipProps = { name: string; color?: string | null }

/** An Option as a pill with a colored dot; the name is always there, color is never the only signal. */
export function OptionChip({ name, color }: OptionChipProps) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-fg">
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: OPTION_COLORS[color ?? 'gray'] ?? OPTION_COLORS.gray }}
      />
      {name}
    </span>
  )
}
