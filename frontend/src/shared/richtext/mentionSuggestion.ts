import type { SuggestionOptions } from '@tiptap/suggestion'

export type MentionMember = { id: string; name: string }

/** Lets the editor's long-lived extension read the latest member list. */
export function createMembersHolder() {
  let current: MentionMember[] = []
  return {
    get: () => current,
    set: (members: MentionMember[]) => {
      current = members
    },
  }
}

/**
 * A small DOM popup for the `@` picker (no framework needed): filtered as you type, arrow keys
 * move, Enter picks, Escape closes, "No members match" when the filter is empty.
 */
export function mentionSuggestion(
  getMembers: () => MentionMember[],
): Omit<SuggestionOptions<MentionMember>, 'editor'> {
  return {
    char: '@',
    items: ({ query }) => {
      const q = query.trim().toLowerCase()
      return getMembers()
        .filter((member) => member.name.toLowerCase().includes(q))
        .slice(0, 8)
    },
    command: ({ editor, range, props }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: 'mention', attrs: { id: props.id, label: props.name } },
          { type: 'text', text: ' ' },
        ])
        .run()
    },
    render: () => {
      let popup: HTMLDivElement | null = null
      let items: MentionMember[] = []
      let selected = 0
      let pick: (member: MentionMember) => void = () => {}

      const draw = () => {
        if (!popup) return
        popup.replaceChildren()
        if (items.length === 0) {
          const empty = document.createElement('div')
          empty.textContent = 'No members match'
          empty.className = 'px-3 py-1.5 text-sm text-slate-500'
          popup.append(empty)
          return
        }
        items.forEach((member, index) => {
          const option = document.createElement('button')
          option.type = 'button'
          option.setAttribute('role', 'option')
          option.setAttribute('aria-selected', String(index === selected))
          option.textContent = member.name
          option.className = `block w-full px-3 py-1.5 text-left text-sm ${index === selected ? 'bg-blue-50' : ''}`
          // mousedown, not click: the editor must not lose focus before the pick
          option.addEventListener('mousedown', (event) => {
            event.preventDefault()
            pick(member)
          })
          popup!.append(option)
        })
      }

      const place = (rect: (() => DOMRect | null) | null | undefined) => {
        if (!popup) return
        const box = rect?.()
        popup.style.left = `${(box?.left ?? 0) + window.scrollX}px`
        popup.style.top = `${(box?.bottom ?? 0) + window.scrollY + 4}px`
      }

      return {
        onStart: (props) => {
          popup = document.createElement('div')
          popup.setAttribute('role', 'listbox')
          popup.setAttribute('aria-label', 'Mention a member')
          popup.className =
            'absolute z-50 min-w-48 rounded border border-slate-200 bg-white py-1 shadow-lg'
          document.body.append(popup)
          items = props.items
          selected = 0
          pick = (member) => props.command(member)
          place(props.clientRect)
          draw()
        },
        onUpdate: (props) => {
          items = props.items
          selected = 0
          pick = (member) => props.command(member)
          place(props.clientRect)
          draw()
        },
        onKeyDown: ({ event }) => {
          if (event.key === 'Escape') {
            popup?.remove()
            popup = null
            return true
          }
          if (items.length === 0) return false
          if (event.key === 'ArrowDown') selected = (selected + 1) % items.length
          else if (event.key === 'ArrowUp') selected = (selected - 1 + items.length) % items.length
          else if (event.key === 'Enter') {
            pick(items[selected])
            return true
          } else return false
          draw()
          return true
        },
        onExit: () => {
          popup?.remove()
          popup = null
        },
      }
    },
  }
}
