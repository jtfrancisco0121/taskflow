import { afterEach, describe, expect, it } from 'vitest'
import { keepFocusIfMoved, keepFocusOrEnterDialog } from './floating'

afterEach(() => {
  document.body.innerHTML = ''
})

const closeEvent = () => new Event('focusScope.autoFocusOnUnmount', { cancelable: true })

describe('close auto-focus', () => {
  it('keepFocusIfMoved leaves the return to the trigger when focus fell to the body inside a modal Dialog', () => {
    document.body.innerHTML = `<div role="dialog" aria-modal="true"><input /><button>Trigger</button></div>`
    const event = closeEvent()
    keepFocusIfMoved(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('keepFocusOrEnterDialog moves focus into a Dialog opened by a pick', () => {
    document.body.innerHTML = `<div role="dialog" aria-modal="true"><input id="first" /></div>`
    const event = closeEvent()
    keepFocusOrEnterDialog(event)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe('first')
  })
})
