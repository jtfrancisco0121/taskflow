const sizes = { 20: 'h-5 w-5 text-[10px]', 24: 'h-6 w-6 text-[11px]', 32: 'h-8 w-8 text-xs' }

type AvatarProps = { name: string; src?: string; size?: keyof typeof sizes }

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '')
  ).toUpperCase()
}

/** A circle with the person's initials, or their image when there is one. */
export function Avatar({ name, src, size = 24 }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={`${sizes[size].split(' ').slice(0, 2).join(' ')} rounded-full object-cover`}
      />
    )
  }
  return (
    <span
      role="img"
      aria-label={name}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent ${sizes[size]}`}
    >
      <span aria-hidden="true">{initials(name)}</span>
    </span>
  )
}
