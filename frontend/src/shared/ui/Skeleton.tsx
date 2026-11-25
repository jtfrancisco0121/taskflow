/** A loading bar. The shimmer stops under reduced motion. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-sm bg-surface-3 motion-reduce:animate-none ${className ?? 'h-4 w-full'}`}
    />
  )
}
