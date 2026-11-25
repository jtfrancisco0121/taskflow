import { useState } from 'react'
import { Button } from '../shared/ui/Button'

type Choice = 'light' | 'dark' | 'system'

const CHOICES: { value: Choice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Aurora' },
  { value: 'system', label: 'System' },
]

function current(): Choice {
  const attr = document.documentElement.getAttribute('data-theme')
  return attr === 'light' || attr === 'dark' ? attr : 'system'
}

/**
 * /design only: writes data-theme on <html> (System removes it, AD-2) and stores nothing.
 * The real theme switcher and its persistence belong to slice 3.
 */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>(current)
  function apply(next: Choice) {
    if (next === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', next)
    setChoice(next)
  }
  return (
    <div role="group" aria-label="Theme" className="flex gap-1">
      {CHOICES.map(({ value, label }) => (
        <Button
          key={value}
          variant="ghost"
          aria-pressed={choice === value}
          onClick={() => apply(value)}
          className={choice === value ? 'bg-accent-soft !text-accent' : ''}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}
