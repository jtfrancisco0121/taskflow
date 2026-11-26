import { useEffect, useState } from 'react'
import { getSessionUser } from '../../api/session'
import { useMembers } from '../workspace'
import { useRealtime } from './RealtimeContext'

const HEARTBEAT_MS = 20_000

/** RT-2: "<name> is viewing this", from the task's presence topic; a heartbeat every 20 s. */
export function Presence({ taskId, workspaceId }: { taskId: string; workspaceId: string }) {
  const client = useRealtime()
  const { members } = useMembers(workspaceId)
  const [viewers, setViewers] = useState<string[]>([])
  const me = getSessionUser()?.id

  useEffect(() => {
    if (!client) return
    const off = client.subscribe(`/topic/task/${taskId}/presence`, (body) => {
      try {
        const message = JSON.parse(body) as { viewers?: string[] }
        setViewers(message.viewers ?? [])
      } catch {
        // ignored
      }
    })
    const beat = () => client.send(`/app/presence/${taskId}`)
    beat()
    const timer = setInterval(beat, HEARTBEAT_MS)
    // Closing the panel unsubscribes, which removes the viewer on the server.
    return () => {
      clearInterval(timer)
      off()
    }
  }, [client, taskId])

  const names = viewers
    .filter((id) => id !== me)
    .map((id) => members.find((m) => m.userId === id)?.displayName ?? 'Someone')
  if (names.length === 0) return null
  return (
    <p role="status" className="rounded bg-warn-soft px-2 py-1 text-sm text-fg">
      {names.length === 1
        ? `${names[0]} is viewing this`
        : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are viewing this`}
    </p>
  )
}
