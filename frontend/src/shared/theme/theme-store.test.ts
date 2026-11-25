import { afterEach, describe, expect, it, vi } from 'vitest'
import { THEME_CHOICES, THEME_KEY, useThemeStore } from './theme-store'

const attr = () => document.documentElement.getAttribute('data-theme')

describe('theme store', () => {
  afterEach(() => vi.restoreAllMocks())

  it('exports the key and the three choices', () => {
    expect(THEME_KEY).toBe('taskflow:theme')
    expect([...THEME_CHOICES]).toEqual(['light', 'dark', 'system'])
  })

  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
    ['system', null],
  ] as const)('%s sets the attribute and writes the key', (choice, expected) => {
    document.documentElement.setAttribute('data-theme', 'dark')
    useThemeStore.getState().setChoice(choice)
    expect(attr()).toBe(expected)
    expect(localStorage.getItem(THEME_KEY)).toBe(choice)
    expect(useThemeStore.getState().choice).toBe(choice)
  })

  it('still applies the theme when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => useThemeStore.getState().setChoice('dark')).not.toThrow()
    expect(attr()).toBe('dark')
    expect(useThemeStore.getState().choice).toBe('dark')
  })

  it('initialises from the attribute the bootstrap set', async () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    vi.resetModules()
    const fresh = await import('./theme-store')
    expect(fresh.useThemeStore.getState().choice).toBe('dark')
    document.documentElement.removeAttribute('data-theme')
    vi.resetModules()
    const none = await import('./theme-store')
    expect(none.useThemeStore.getState().choice).toBe('system')
  })
})
