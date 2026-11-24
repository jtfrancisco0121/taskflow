import type { JSONContent } from '@tiptap/core'

/** AD-8: rich text is ProseMirror JSON end to end. */
export type RichDoc = JSONContent

export const MAX_DOC_BYTES = 256 * 1024

export const EMPTY_DOC: RichDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

function hasContent(node: RichDoc): boolean {
  if (node.type === 'text') return !!node.text
  if (node.type === 'mention' || node.type === 'hardBreak') return true
  return (node.content ?? []).some(hasContent)
}

/** True for null, `{type:'doc'}` and a doc with only empty paragraphs. */
export function isEmptyDoc(doc: RichDoc | null | undefined): boolean {
  return !doc || !hasContent(doc)
}

export function isTooLarge(doc: RichDoc): boolean {
  return new TextEncoder().encode(JSON.stringify(doc)).length > MAX_DOC_BYTES
}

/** Plain text of a doc (for a short preview); mentions become `@label`. */
export function docToText(doc: RichDoc | null | undefined): string {
  if (!doc) return ''
  if (doc.type === 'text') return doc.text ?? ''
  if (doc.type === 'mention') return `@${String(doc.attrs?.label ?? doc.attrs?.id ?? '')}`
  const parts = (doc.content ?? []).map(docToText)
  return doc.type === 'doc' ? parts.join('\n') : parts.join('')
}
