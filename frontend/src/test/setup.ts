import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { clearSession, resetSessionForTests } from '../api/session'
import { useToastStore } from '../shared/toast-store'
import { useThemeStore } from '../shared/theme/theme-store'
import { useUiStore } from '../shared/ui-store'

// AD-12: component tests stub HTTP by giving `api` a stub fetch (see installFetch in test/api.tsx).
// Registered here so every test file gets it; a file may still mock the module itself.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  const { testFetch } = await import('./fetch-ref')
  return {
    ...actual,
    api: actual.createApiClient({
      baseUrl: 'http://localhost',
      fetch: (request) => testFetch.current(request),
    }),
  }
})

// jsdom lacks these; ProseMirror and the task list use them.
const emptyRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] })
const rect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 })
if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects = emptyRects as unknown as Range['getClientRects']
  Range.prototype.getBoundingClientRect = rect as unknown as Range['getBoundingClientRect']
}
if (typeof document !== 'undefined') {
  document.elementFromPoint = () => null
}
if (typeof window !== 'undefined' && !window.IntersectionObserver) {
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
    root = null
    rootMargin = ''
    thresholds = []
  } as unknown as typeof IntersectionObserver
}
if (typeof window !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {}
}
// Radix Select (slice 2 on) needs pointer capture, which jsdom lacks.
if (typeof window !== 'undefined' && !window.HTMLElement.prototype.hasPointerCapture) {
  window.HTMLElement.prototype.hasPointerCapture = () => false
}
if (typeof window !== 'undefined' && !window.HTMLElement.prototype.releasePointerCapture) {
  window.HTMLElement.prototype.releasePointerCapture = () => {}
}

// Radix Popper (Popover, Tooltip, DropdownMenu, Select) measures with ResizeObserver, which jsdom lacks.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

afterEach(() => {
  cleanup()
  clearSession()
  resetSessionForTests()
  if (typeof localStorage !== 'undefined') localStorage.clear()
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear()
  useToastStore.setState({ toasts: [] })
  if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-theme')
  useThemeStore.setState({ choice: 'system' })
  useUiStore.setState({
    sidebarOpen: true,
    creatingSpace: false,
    paletteOpen: false,
    paletteRequested: false,
    shellReady: false,
    taskDetailMode: null,
    expanded: {},
  })
})

// Component tests never open a socket: the STOMP client of the app shell gets a socket that stays closed.
class ClosedWebSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readyState = 3
  binaryType = 'blob'
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: Event) => void) | null = null
  send() {}
  close() {}
}
vi.stubGlobal('WebSocket', ClosedWebSocket)
