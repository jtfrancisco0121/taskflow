/**
 * One Idempotency-Key per user submission. A retry of the same body reuses the key (so a request
 * that timed out but succeeded is not created twice); a changed body gets a new key; a success
 * ends the submission.
 */
export class IdempotencyKeys {
  private body: string | null = null
  private key: string | null = null

  keyFor(body: unknown): string {
    const serialized = JSON.stringify(body)
    if (this.key === null || this.body !== serialized) {
      this.key = crypto.randomUUID()
      this.body = serialized
    }
    return this.key
  }

  done() {
    this.body = null
    this.key = null
  }
}
