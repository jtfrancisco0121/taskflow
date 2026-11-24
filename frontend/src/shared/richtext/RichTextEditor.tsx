import Link from '@tiptap/extension-link'
import Mention from '@tiptap/extension-mention'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useMemo, useRef, useState } from 'react'
import { isTooLarge, type RichDoc } from './doc'
import { createMembersHolder, mentionSuggestion, type MentionMember } from './mentionSuggestion'

type RichTextEditorProps = {
  /** ProseMirror doc JSON (AD-8); null or undefined is an empty document. */
  value?: RichDoc | null
  onChange?: (doc: RichDoc) => void
  onBlur?: (doc: RichDoc) => void
  /** Cmd/Ctrl+Enter. */
  onSubmit?: () => void
  members?: MentionMember[]
  label: string
  placeholder?: string
  readOnly?: boolean
  /** Hide the toolbar (the read-only view). */
  bare?: boolean
}

/**
 * The one editor for descriptions and comments: StarterKit reduced to bold, italic and lists, plus
 * Link and Mention. It never renders server content as HTML (ProseMirror builds the DOM from the
 * JSON). A doc that fails the content check is shown read-only so a save cannot overwrite it.
 */
export function RichTextEditor({
  value,
  onChange,
  onBlur,
  onSubmit,
  members = [],
  label,
  placeholder,
  readOnly,
  bare,
}: RichTextEditorProps) {
  const [holder] = useState(createMembersHolder)
  const unreadableRef = useRef(false)
  const callbacks = useRef({ onChange, onBlur, onSubmit })
  const [unreadable, setUnreadable] = useState(false)
  const [tooLarge, setTooLarge] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  useEffect(() => {
    holder.set(members)
    callbacks.current = { onChange, onBlur, onSubmit }
  })

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: false,
      }),
      // Link keeps its default isAllowedUri, which refuses javascript: and similar URLs.
      Link.configure({ openOnClick: false, autolink: true }),
      Mention.configure({
        HTMLAttributes: { class: 'rounded bg-blue-100 px-1 text-blue-900' },
        suggestion: mentionSuggestion(holder.get),
      }),
    ],
    [holder],
  )

  const editor = useEditor({
    extensions,
    content: value ?? undefined,
    editable: !readOnly,
    enableContentCheck: true,
    onContentError: ({ editor: failed }) => {
      unreadableRef.current = true
      setUnreadable(true)
      failed.setEditable(false)
    },
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        class: 'min-h-16 px-2 py-1.5 text-sm outline-none',
      },
      handleKeyDown: (_view, event) => {
        if (
          event.key === 'Enter' &&
          (event.metaKey || event.ctrlKey) &&
          callbacks.current.onSubmit
        ) {
          event.preventDefault()
          callbacks.current.onSubmit()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: current }) => {
      if (unreadableRef.current) return
      const doc = current.getJSON()
      const big = isTooLarge(doc)
      setTooLarge(big)
      if (!big) callbacks.current.onChange?.(doc)
    },
    onBlur: ({ editor: current }) => {
      const doc = current.getJSON()
      if (!isTooLarge(doc) && !unreadableRef.current) callbacks.current.onBlur?.(doc)
    },
  })
  // Follow outside changes (a conflict's server version, a cleared composer) while not typing.
  useEffect(() => {
    if (!editor || editor.isFocused || unreadable) return
    const next = value ?? { type: 'doc', content: [{ type: 'paragraph' }] }
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(next)) {
      editor.commands.setContent(next, { emitUpdate: false })
    }
  }, [editor, value, unreadable])

  useEffect(() => {
    editor?.setEditable(!readOnly && !unreadable)
  }, [editor, readOnly, unreadable])

  if (!editor) return null
  const toolbar = !bare && !readOnly && !unreadable

  return (
    <div className="rounded border border-slate-300 bg-white">
      {toolbar && (
        <div
          role="toolbar"
          aria-label={`${label} formatting`}
          className="flex gap-1 border-b border-slate-200 p-1"
        >
          <ToolButton
            label="Bold"
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            B
          </ToolButton>
          <ToolButton
            label="Italic"
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            I
          </ToolButton>
          <ToolButton
            label="Bullet list"
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            •
          </ToolButton>
          <ToolButton
            label="Numbered list"
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            1.
          </ToolButton>
          <ToolButton
            label="Link"
            active={editor.isActive('link')}
            onClick={() => {
              setLinkUrl((editor.getAttributes('link').href as string | undefined) ?? '')
              setLinkOpen((open) => !open)
            }}
          >
            ↗
          </ToolButton>
          <ToolButton
            label="Mention"
            onClick={() => editor.chain().focus().insertContent('@').run()}
          >
            @
          </ToolButton>
        </div>
      )}
      {toolbar && linkOpen && (
        <form
          className="flex gap-1 border-b border-slate-200 p-1"
          onSubmit={(event) => {
            event.preventDefault()
            const url = linkUrl.trim()
            const chain = editor.chain().focus().extendMarkRange('link')
            if (url) chain.setLink({ href: url }).run()
            else chain.unsetLink().run()
            setLinkOpen(false)
          }}
        >
          <input
            aria-label="Link URL"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            className="flex-1 rounded border border-slate-300 px-1.5 py-0.5 text-sm"
          />
          <button type="submit" className="rounded border border-slate-300 px-2 text-sm">
            Apply link
          </button>
        </form>
      )}
      <EditorContent editor={editor} data-placeholder={placeholder} />
      {unreadable && (
        <p
          role="status"
          className="border-t border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900"
        >
          This content uses features the editor cannot show, so it is read-only to protect it.
        </p>
      )}
      {tooLarge && (
        <p
          role="alert"
          className="border-t border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800"
        >
          This text is too long to save (limit 256 KB).
        </p>
      )}
    </div>
  )
}

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      // keep the selection in the editor
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`h-7 min-w-7 rounded px-1.5 text-sm hover:bg-slate-100 ${active ? 'bg-slate-200 font-bold' : ''}`}
    >
      {children}
    </button>
  )
}
