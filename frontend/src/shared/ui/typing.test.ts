import { describe, expect, it } from 'vitest'
import { isTypingTarget } from './typing'

function el(html: string): Element {
  const host = document.createElement('div')
  host.innerHTML = html
  return host.firstElementChild!.querySelector('[data-t]') ?? host.firstElementChild!
}

describe('isTypingTarget', () => {
  it.each([
    '<input />',
    '<textarea></textarea>',
    '<select></select>',
    '<div contenteditable="true"><span data-t></span></div>',
    '<button role="combobox">Status</button>',
    '<div data-tf-floating><button data-t>Item</button></div>',
  ])('is true for %s', (html) => expect(isTypingTarget(el(html))).toBe(true))

  it.each(['<button>Plain</button>', '<div><p data-t>text</p></div>'])('is false for %s', (html) =>
    expect(isTypingTarget(el(html))).toBe(false),
  )

  it('is false for null and non-elements', () => {
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget(window)).toBe(false)
  })
})
