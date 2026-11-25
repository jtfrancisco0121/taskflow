import type { ReactNode } from 'react'

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm glass rounded-xl p-6">
        <h1 className="mb-4 font-display text-xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  )
}
