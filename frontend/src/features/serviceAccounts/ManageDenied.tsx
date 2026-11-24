import { PageHeader } from '../../shared/ui/PageHeader'

/** The 403 state: a member or guest who opens a settings URL directly. */
export function ManageDenied() {
  return (
    <div className="mx-auto max-w-[960px]">
      <PageHeader title="Service accounts" />
      <p role="alert" className="text-sm">
        Only Workspace owners and admins can manage service accounts.
      </p>
    </div>
  )
}
