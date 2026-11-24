import type { Virtualizer } from '@tanstack/react-virtual'

const FALLBACK = { width: 1000, height: 600 }

/**
 * Observes the scroll container's size, falling back to a plain 1000 x 600 box when the element
 * has no layout (jsdom, or a hidden tab), so the first rows always render.
 */
export function observeRect(
  instance: Virtualizer<HTMLDivElement, Element>,
  cb: (rect: { width: number; height: number }) => void,
) {
  const element = instance.scrollElement as HTMLElement | null
  if (!element) return undefined
  const measure = () => ({
    width: element.offsetWidth || FALLBACK.width,
    height: element.offsetHeight || FALLBACK.height,
  })
  cb(measure())
  if (typeof ResizeObserver === 'undefined') return undefined
  const observer = new ResizeObserver(() => cb(measure()))
  observer.observe(element)
  return () => observer.disconnect()
}
