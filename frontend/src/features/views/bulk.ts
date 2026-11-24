/** AD-10: Bulk actions fan out on the client, at most `limit` requests in flight. */
export async function runLimited<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  limit = 6,
): Promise<Array<{ item: T; result: R }>> {
  const out: Array<{ item: T; result: R }> = new Array(items.length)
  let next = 0
  async function lane() {
    while (next < items.length) {
      const index = next++
      out[index] = { item: items[index], result: await worker(items[index]) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  return out
}
