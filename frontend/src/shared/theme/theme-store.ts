import { create } from 'zustand'

/** AD-1/AD-2: the one runtime writer of data-theme. The index.html bootstrap reads the same key. */
export const THEME_KEY = 'taskflow:theme'
export const THEME_CHOICES = ['light', 'dark', 'system'] as const
export type ThemeChoice = (typeof THEME_CHOICES)[number]

/** Initial choice comes from the attribute the bootstrap set (never matchMedia). */
function readChoice(): ThemeChoice {
  if (typeof document === 'undefined') return 'system'
  const attr = document.documentElement.getAttribute('data-theme')
  return attr === 'light' || attr === 'dark' ? attr : 'system'
}

function applyChoice(choice: ThemeChoice) {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', choice)
}

type ThemeState = {
  choice: ThemeChoice
  setChoice: (choice: ThemeChoice) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  choice: readChoice(),
  setChoice: (choice) => {
    try {
      localStorage.setItem(THEME_KEY, choice)
    } catch {
      // storage unavailable: the choice applies to this session only
    }
    applyChoice(choice)
    set({ choice })
  },
}))
