import { useState } from 'react'
import type { TaskView } from '../../api/types'
import { ActivityTab } from './ActivityTab'
import { CommentsTab } from './CommentsTab'

type Tab = 'comments' | 'activity'

/** The Task panel's Comments and Activity tabs. */
export function TaskTabs({ task }: { task: TaskView }) {
  const [tab, setTab] = useState<Tab>('comments')
  return (
    <section aria-label="Task discussion">
      <div role="tablist" className="mb-3 flex gap-1 border-b border-line">
        {(['comments', 'activity'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`tabpanel-${id}`}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-sm ${tab === id ? 'border-b-2 border-accent font-medium' : 'text-muted'}`}
          >
            {id === 'comments' ? 'Comments' : 'Activity'}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'comments' ? <CommentsTab task={task} /> : <ActivityTab task={task} />}
      </div>
    </section>
  )
}
