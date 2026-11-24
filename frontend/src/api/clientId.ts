/** AD-17: one random id per browser tab, created at boot. Only `client.ts` and the STOMP client send it. */
export const clientId: string = globalThis.crypto.randomUUID()
