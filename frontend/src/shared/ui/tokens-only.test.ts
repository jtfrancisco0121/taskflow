// @vitest-environment node
import { describe, expect, it } from 'vitest'

// AD-1: the component library and the /design page use semantic token utilities only.
const PALETTES =
  'white|black|slate|gray|zinc|neutral|stone|red|amber|yellow|orange|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|lime'

describe('the library, /design, the shell and the rebuilt feature files use tokens only', () => {
  // AD-8: the library, /design, the app shell and the feature files rebuilt on tokens.
  const files = import.meta.glob(
    [
      './**/*.tsx',
      '../../design/**/*.tsx',
      '../../app/**/*.tsx',
      '../../features/locations/{SidebarTree,TreeItem,TreeItemMenu,InlineNameField}.tsx',
      '../../features/workspace/WorkspaceSwitcher.tsx',
      '../../features/notifications/{NotificationBell,InboxLink}.tsx',
      '../../features/search/SearchBox.tsx',
      '../../features/serviceAccounts/ServiceAccountsLink.tsx',
      '../../features/tasks/{TaskPanelRoute,TaskPanel}.tsx',
      '../../features/views/{FilterBuilder,ChipBar,ViewTabs,ViewPage,ListRenderer,ListEditors,ColumnsPicker,ResultNotices,BulkBar}.tsx',
      '../../features/tasks/QuickAdd.tsx',
      // slice 5: the task detail
      '../../features/tasks/{TaskFields,FieldShell,CustomFieldsGroup,ConflictBanner,SubtasksSection,ChecklistsSection,editorItems}.tsx',
      '../../features/comments/{TaskTabs,CommentsTab,ActivityTab}.tsx',
      '../../features/dependencies/{DependenciesSection,DependencyPicker,BlockedBadge,CompleteAnywayDialog}.tsx',
      '../../features/realtime/Presence.tsx',
      '../../features/notifications/WatchControl.tsx',
      '../../features/fields/{ValueEditor,People}.tsx',
      '../../features/fields/FilterInput.tsx',
      // slice 6: the Board
      '../../features/fields/{ValueChip,OptionChip}.tsx',
      '../../features/views/{BoardRenderer,BoardColumn,BoardCard}.tsx',
    ],
    {
      query: '?raw',
      import: 'default',
      eager: true,
    },
  ) as Record<string, string>

  it('scans the library', () => {
    expect(Object.keys(files).length).toBeGreaterThan(5)
  })

  it('has no hex, rgb() or raw palette class', () => {
    const palette = new RegExp(
      `\\b(?:[a-z-]+:)*(?:bg|text|border|ring|outline|fill|stroke|divide|from|to|via|shadow)-(?:${PALETTES})(?:-\\d+)?\\b`,
    )
    const offenders: string[] = []
    for (const [file, source] of Object.entries(files)) {
      if (/\.test\.tsx$/.test(file)) continue
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(code))
        offenders.push(`${file}: literal colour`)
      const m = palette.exec(code)
      if (m) offenders.push(`${file}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('keeps a visible focus ring on the Board card (no outline-none, a 2px outline on focus-visible)', () => {
    const card = Object.entries(files).find(([f]) => f.endsWith('/BoardCard.tsx'))?.[1] ?? ''
    expect(card).not.toMatch(/\boutline-none\b/)
    expect(card).toMatch(/focus-visible:outline-2\b/)
  })
})
