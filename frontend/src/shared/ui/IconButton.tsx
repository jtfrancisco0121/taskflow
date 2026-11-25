import type { ButtonHTMLAttributes, Ref } from 'react'
import { Tooltip } from './Tooltip'

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> & {
  /** Required: the accessible name and the tooltip. */
  label: string
  /** The icon, an <svg aria-hidden="true">. */
  children: React.ReactNode
  ref?: Ref<HTMLButtonElement>
}

/** A square, icon-only ghost button. Its `label` is the aria-label and the tooltip. */
export function IconButton({ label, className, type, children, ...rest }: IconButtonProps) {
  return (
    <Tooltip label={label}>
      <button
        type={type ?? 'button'}
        aria-label={label}
        className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors duration-(--tf-dur-fast) hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ''}`}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  )
}
