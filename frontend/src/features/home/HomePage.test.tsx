import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HomePage } from './HomePage'

const fetchStub = vi.hoisted(() => vi.fn())

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>()
  return {
    ...actual,
    api: actual.createApiClient({ baseUrl: 'http://localhost', fetch: fetchStub }),
  }
})

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <HomePage />
    </QueryClientProvider>,
  )
}

describe('HomePage', () => {
  beforeEach(() => {
    fetchStub.mockReset()
  })

  it('shows the backend name and version', async () => {
    fetchStub.mockResolvedValue(
      new Response(JSON.stringify({ name: 'taskflow', version: '1.2.3' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    renderPage()

    expect(await screen.findByText('taskflow')).toBeInTheDocument()
    expect(screen.getByText('1.2.3')).toBeInTheDocument()
    const request = fetchStub.mock.calls[0][0] as Request
    expect(request.url).toBe('http://localhost/api/v1/meta')
  })

  it('shows an error message when the backend answers 500', async () => {
    fetchStub.mockResolvedValue(
      new Response(JSON.stringify({ title: 'Internal Server Error', status: 500 }), {
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
    )

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the backend')
  })
})
