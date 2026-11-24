import type { ReactNode } from 'react'

type PageHeaderProps = {
  title: string
  children?: ReactNode
}

export function PageHeader({ title, children }: PageHeaderProps) {
  return (
    <header className="mb-4 flex items-center justify-between">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </header>
  )
}
