import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { RichDoc } from './doc'
import { RichTextEditor } from './RichTextEditor'
import { RichTextView } from './RichTextView'

const para = (text: string): RichDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('RichTextEditor', () => {
  it('AD-8: reads a ProseMirror doc and emits ProseMirror JSON on change', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<RichTextEditor value={para('Hello')} onChange={onChange} label="Description" />)

    const box = await screen.findByRole('textbox', { name: 'Description' })
    expect(box).toHaveTextContent('Hello')
    await user.click(box)
    await user.keyboard(' world')

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const doc = onChange.mock.calls.at(-1)![0] as RichDoc
    expect(doc.type).toBe('doc')
    expect(JSON.stringify(doc)).toContain('Hello')
    expect(JSON.stringify(doc)).toContain('world')
  })

  it('AD-8: picking a member from the @ picker emits a mention node with attrs.id and label', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <RichTextEditor
        onChange={onChange}
        label="Comment"
        members={[
          { id: 'u1', name: 'Maya Lopez' },
          { id: 'u2', name: 'Omar Haddad' },
        ]}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Mention' }))
    const option = await screen.findByRole('option', { name: 'Maya Lopez' })
    expect(screen.getByRole('option', { name: 'Omar Haddad' })).toBeVisible()
    await user.pointer({ keys: '[MouseLeft]', target: option })

    await waitFor(() => {
      const doc = onChange.mock.calls.at(-1)?.[0] as RichDoc
      expect(JSON.stringify(doc)).toContain('"type":"mention"')
    })
    const doc = onChange.mock.calls.at(-1)![0] as RichDoc
    const mention = doc.content![0].content!.find((n) => n.type === 'mention')!
    expect(mention.attrs).toMatchObject({ id: 'u1', label: 'Maya Lopez' })
    expect(JSON.stringify(doc)).not.toContain('<')
  })

  it('NFR-2: a link mark with a javascript: href renders no javascript: link', async () => {
    const doc: RichDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click me',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    }
    const { container } = render(<RichTextView doc={doc} label="Comment" />)

    await screen.findByText('click me')
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
    expect(container.innerHTML.toLowerCase()).not.toContain('href="javascript')
  })

  it('NFR-2: renders plain text from JSON and never interprets HTML in text nodes', async () => {
    const { container } = render(
      <RichTextView doc={para('<img src=x onerror=alert(1)>')} label="Comment" />,
    )

    await screen.findByText('<img src=x onerror=alert(1)>')
    expect(container.querySelector('img')).toBeNull()
  })

  it('AD-8: an unknown node type makes the editor read-only and it emits nothing', async () => {
    const onChange = vi.fn()
    const onBlur = vi.fn()
    const user = userEvent.setup()
    const doc = { type: 'doc', content: [{ type: 'mysteryWidget' }] } as RichDoc
    render(<RichTextEditor value={doc} onChange={onChange} onBlur={onBlur} label="Description" />)

    expect(await screen.findByText(/read-only to protect it/)).toBeVisible()
    const box = screen.getByRole('textbox', { name: 'Description' })
    expect(box).toHaveAttribute('contenteditable', 'false')
    await user.click(box)
    await user.keyboard('x')
    expect(onChange).not.toHaveBeenCalled()
    expect(onBlur).not.toHaveBeenCalled()
  })
})
