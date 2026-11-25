import { THEME_CHOICES, useThemeStore, type ThemeChoice } from '../theme/theme-store'
import { Button } from './Button'

const LABELS: Record<ThemeChoice, string> = { light: 'Light', dark: 'Aurora', system: 'System' }

/** The one theme switcher (AD-2): Light / Aurora / System. */
export function ThemeSwitcher() {
  const choice = useThemeStore((state) => state.choice)
  const setChoice = useThemeStore((state) => state.setChoice)
  return (
    <div role="group" aria-label="Theme" className="flex gap-1">
      {THEME_CHOICES.map((value) => (
        <Button
          key={value}
          variant="ghost"
          aria-pressed={choice === value}
          onClick={() => setChoice(value)}
          className={choice === value ? 'bg-accent-soft !text-accent' : ''}
        >
          {LABELS[value]}
        </Button>
      ))}
    </div>
  )
}
