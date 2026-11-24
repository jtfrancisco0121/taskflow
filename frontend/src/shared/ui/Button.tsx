import type { ButtonHTMLAttributes } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger'
}

const styles = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 border-blue-600',
  secondary: 'bg-white text-slate-900 hover:bg-slate-100 border-slate-300',
  danger: 'bg-red-600 text-white hover:bg-red-700 border-red-600',
}

export function Button({ variant = 'secondary', className, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={`rounded border px-3 py-1.5 text-sm font-medium focus:outline-2 focus:outline-offset-2 focus:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className ?? ''}`}
      {...rest}
    />
  )
}
