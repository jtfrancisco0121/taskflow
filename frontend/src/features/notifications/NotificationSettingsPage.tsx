import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { api } from '../../api/client'
import { messageOf, unwrap } from '../../api/errors'
import { queryKeys } from '../../api/queryKeys'
import { useToastStore } from '../../shared/toast-store'

type Pref = { kind?: string; inApp?: boolean; emailDigest?: boolean }
type Prefs = { kinds?: Pref[] }

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
  const queryClient = useQueryClient()
  const toast = useToastStore((s) => s.show)
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
  const save = useMutation({
    mutationFn: (pref: Required<Pref>) =>
      unwrap(
        api.PUT('/api/v1/workspaces/{id}/notification-preferences', {
          params: { path: { id: workspaceId } },
          body: { kinds: [pref] },
        }),
      ),
    // Optimistic: the switch moves at once and goes back when the server refuses.
    onMutate: async (pref) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Prefs>(key)
      queryClient.setQueryData<Prefs>(key, {
        kinds: previous?.kinds?.map((k) => (k.kind === pref.kind ? { ...k, ...pref } : k)),
      })
      return { previous }
    },
    onError: (error, _pref, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      toast(messageOf(error), 'error')
    },
    onSuccess: () => toast('Notification settings saved'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  return (
    <section aria-label="Notification settings" className="max-w-2xl">
      <header className="mb-3 flex items-center gap-2">
        <h1 className="text-2xl font-semibold">Notification settings</h1>
        <Link to={`/w/${workspaceId}/inbox`} className="ml-auto text-sm text-blue-700 underline">
          Back to the inbox
        </Link>
      </header>
      {prefs.isPending && <p role="status">Loading…</p>}
      {prefs.isError && (
        <p role="alert" className="text-red-700">
          {messageOf(prefs.error)}
        </p>
      )}
      {prefs.isSuccess && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-600">
              <th className="py-1 font-medium">Event</th>
              <th className="py-1 font-medium">In app</th>
              <th className="py-1 font-medium">Email digest</th>
            </tr>
          </thead>
          <tbody>
            {(prefs.data.kinds ?? []).map((k) => {
              const label = LABEL[k.kind ?? ''] ?? k.kind ?? ''
              const update = (patch: Partial<Pref>) =>
                save.mutate({
                  kind: k.kind!,
                  inApp: k.inApp ?? true,
                  emailDigest: k.emailDigest ?? false,
                  ...patch,
                })
              return (
                <tr key={k.kind} className="border-t border-slate-200">
                  <th scope="row" className="py-2 text-left font-normal">
                    {label}
                  </th>
                  <td>
                    <Switch
                      label={`${label}: In app`}
                      checked={k.inApp ?? true}
                      onChange={(inApp) => update({ inApp })}
                    />
                  </td>
                  <td>
                    <Switch
                      label={`${label}: Email digest`}
                      checked={k.emailDigest ?? false}
                      onChange={(emailDigest) => update({ emailDigest })}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Email digests are a hook only for now: nothing is sent yet.
      </p>
    </section>
  )
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full ${checked ? 'bg-blue-600' : 'bg-slate-300'} focus:outline-2 focus:outline-offset-2 focus:outline-blue-600`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-4.5' : 'left-0.5'}`}
      />
    </button>
  )
}
