import { RichTextEditor } from './RichTextEditor'
import type { RichDoc } from './doc'

/** Read-only rendering of a stored doc (a comment): ProseMirror builds the DOM, no raw HTML. */
export function RichTextView({ doc, label }: { doc: RichDoc | null | undefined; label: string }) {
  return <RichTextEditor value={doc} label={label} readOnly bare />
}
