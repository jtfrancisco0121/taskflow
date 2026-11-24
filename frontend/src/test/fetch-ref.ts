/** The fetch that the test `api` client uses; each test installs its own stub (see test/api.tsx). */
export const testFetch: { current: (request: Request) => Promise<Response> } = {
  current: async (request) =>
    new Response(JSON.stringify({ title: `No stub installed for ${request.url}`, status: 404 }), {
      status: 404,
      headers: { 'Content-Type': 'application/problem+json' },
    }),
}
