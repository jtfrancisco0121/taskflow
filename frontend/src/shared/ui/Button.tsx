import type { ButtonHTMLAttributes, Ref } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  ref?: Ref<HTMLButtonElement>
}

const styles = {
  primary:
    'border-transparent bg-linear-to-br from-primary-from to-primary-to text-primary-fg hover:brightness-110',
  secondary: 'border-line-strong bg-surface text-fg hover:bg-surface-2',
  danger: 'border-transparent bg-danger text-danger-fg hover:brightness-110',
  ghost: 'border-transparent bg-transparent text-muted hover:bg-surface-2',
}

export function Button({ variant = 'secondary', className, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={`rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors duration-(--tf-dur-fast) disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className ?? ''}`}
      {...rest}
    />
  )
}
