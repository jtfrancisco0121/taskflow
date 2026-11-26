import { afterEach, describe, expect, it } from 'vitest'
import { isShortcutBlocked } from './shortcutGuard'

afterEach(() => {
  document.body.innerHTML = ''
})

const key = (init: Partial<KeyboardEvent> & { target?: EventTarget | null } = {}) =>
  ({ target: document.body, ...init }) as unknown as KeyboardEvent

describe('isShortcutBlocked', () => {
  it('lets a plain key on the page through', () => {
    expect(isShortcutBlocked(key())).toBe(false)
  })

  it('blocks under an open modal dialog but not under the palette panel', () => {
    document.body.innerHTML = '<div role="dialog" aria-modal="true"></div>'
    expect(isShortcutBlocked(key())).toBe(true)
    document.body.innerHTML = '<div role="dialog" aria-modal="true" data-tf-palette></div>'
    expect(isShortcutBlocked(key())).toBe(false)
  })

  it('blocks while a floating layer is open', () => {
    document.body.innerHTML = '<div data-tf-floating></div>'
    expect(isShortcutBlocked(key())).toBe(true)
  })

  it('blocks in a text field unless allowInTextFields', () => {
    document.body.innerHTML = '<input id="f" />'
    const target = document.getElementById('f')
    expect(isShortcutBlocked(key({ target }))).toBe(true)
    expect(isShortcutBlocked(key({ target }), { allowInTextFields: true })).toBe(false)
  })

  it('blocks a single key with Ctrl, Meta or Alt, but singleKey: false lets Cmd/Ctrl+K through', () => {
    expect(isShortcutBlocked(key({ ctrlKey: true }))).toBe(true)
    expect(isShortcutBlocked(key({ metaKey: true }))).toBe(true)
    expect(isShortcutBlocked(key({ altKey: true }))).toBe(true)
    expect(isShortcutBlocked(key({ metaKey: true }), { singleKey: false })).toBe(false)
    expect(isShortcutBlocked(key({ ctrlKey: true }), { singleKey: false })).toBe(false)
  })

  it('host: the dialog that hosts the shortcut is not busy, another modal dialog still is', () => {
    document.body.innerHTML =
      '<div role="dialog" aria-modal="true" id="d"><div id="frame"></div></div>'
    const host = document.getElementById('frame')
    expect(isShortcutBlocked(key())).toBe(true)
    expect(isShortcutBlocked(key(), { host })).toBe(false)
    document.body.insertAdjacentHTML('beforeend', '<div role="dialog" aria-modal="true"></div>')
    expect(isShortcutBlocked(key(), { host })).toBe(true)
  })

  it('host: a floating layer and a text field still block', () => {
    document.body.innerHTML =
      '<div role="dialog" aria-modal="true"><div id="frame"><input id="f" /></div></div>'
    const host = document.getElementById('frame')
    const target = document.getElementById('f')
    expect(isShortcutBlocked(key({ target }), { host })).toBe(true)
    document.body.insertAdjacentHTML('beforeend', '<div data-tf-floating></div>')
    expect(isShortcutBlocked(key(), { host })).toBe(true)
  })
})
