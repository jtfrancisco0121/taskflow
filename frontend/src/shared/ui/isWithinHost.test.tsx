import { render, screen } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { describe, expect, it } from 'vitest'
import { isWithinHost } from './isWithinHost'

describe('isWithinHost', () => {
  it('is true for the host itself and its DOM descendants', () => {
    render(
      <div data-testid="host">
        <button>Inside</button>
      </div>,
    )
    const host = screen.getByTestId('host')
    expect(isWithinHost(host, host)).toBe(true)
    expect(isWithinHost(host, screen.getByRole('button', { name: 'Inside' }))).toBe(true)
  })

  it('is true for a node inside portalled floating content, even outside the host', () => {
    render(
      <>
        <div data-testid="host" />
        {createPortal(
          <div data-tf-floating="">
            <span>Option</span>
          </div>,
          document.body,
        )}
      </>,
    )
    expect(isWithinHost(screen.getByTestId('host'), screen.getByText('Option'))).toBe(true)
  })

  it('is false for a node outside both, and for null', () => {
    render(
      <>
        <div data-testid="host" />
        <p>Elsewhere</p>
      </>,
    )
    const host = screen.getByTestId('host')
    expect(isWithinHost(host, screen.getByText('Elsewhere'))).toBe(false)
    expect(isWithinHost(host, null)).toBe(false)
  })
})
