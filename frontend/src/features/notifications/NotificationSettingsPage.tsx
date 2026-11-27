import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { api } from '../../api/client'
import { messageOf, unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import { EmptyState } from '../../shared/ui/EmptyState'
import { ErrorState } from '../../shared/ui/ErrorState'
import { PageHeader } from '../../shared/ui/PageHeader'
import { Skeleton } from '../../shared/ui/Skeleton'
import { Switch } from '../../shared/ui/Switch'
import { useSavePreference, type Pref } from './useNotifications'

const LABEL: Record<string, string> = {
  ASSIGNED: 'Assigned to me',
  MENTIONED: 'Mentioned',
  COMMENTED: 'Comments on tasks I watch',
  STATUS_CHANGED: 'Status changed',
  DUE_SOON: 'Due soon',
  BLOCKER_RESOLVED: 'A blocker was resolved',
  AUTOMATION: 'Automation messages',
}

/** `/w/:ws/settings/notifications`: which events reach the inbox and the email digest (CAP-13). */
export function NotificationSettingsPage() {
  const { workspaceId = '' } = useParams()
  const key = queryKeys.notificationPreferences(workspaceId)
  const prefs = useQuery({
    queryKey: key,
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/workspaces/{id}/notification-preferences', {
          params: { path: { id: workspaceId } },
        }),
      ),
  })
  const save = useSavePreference(workspaceId)

  const kinds = prefs.data?.kinds ?? []
  return (
    <section aria-label="Notification settings" className="max-w-2xl">
      <PageHeader title="Notification settings">
        <Link to={`/w/${workspaceId}/inbox`} className="text-[13px] text-accent underline">
          Back to the inbox
        </Link>
      </PageHeader>
      {prefs.isPending && (
        <div
          role="status"
          aria-label="Loading notification settings"
          className="flex flex-col gap-2"
        >
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}
      {prefs.isError && (
        <ErrorState message={messageOf(prefs.error)} onRetry={() => void prefs.refetch()} />
      )}
      {prefs.isSuccess && kinds.length === 0 && (
        <EmptyState
          title="No notification events yet."
          description="Events you can choose to hear about will be listed here."
        />
      )}
      {prefs.isSuccess && kinds.length > 0 && (
        <table className="w-full rounded-md border border-line bg-surface text-[13px]">
          <thead>
            <tr className="text-left text-muted">
              <th className="px-3 py-2 font-medium">Event</th>
              <th className="px-3 py-2 font-medium">In app</th>
              <th className="px-3 py-2 font-medium">Email digest</th>
            </tr>
          </thead>
          <tbody>
            {kinds.map((k) => {
              const label = LABEL[k.kind ?? ''] ?? k.kind ?? ''
              const update = (patch: Partial<Pref>) =>
                save.mutate({
                  kind: k.kind!,
                  inApp: k.inApp ?? true,
                  emailDigest: k.emailDigest ?? false,
                  ...patch,
                })
              return (
                <tr key={k.kind} className="border-t border-line">
                  <th scope="row" className="px-3 py-2 text-left font-normal text-fg">
                    {label}
                  </th>
                  <td className="px-3 py-2">
                    <Switch
                      aria-label={`${label}: In app`}
                      checked={k.inApp ?? true}
                      onCheckedChange={(inApp) => update({ inApp })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Switch
                      aria-label={`${label}: Email digest`}
                      checked={k.emailDigest ?? false}
                      onCheckedChange={(emailDigest) => update({ emailDigest })}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-xs text-muted">
        Email digests are a hook only for now: nothing is sent yet.
      </p>
    </section>
  )
}
