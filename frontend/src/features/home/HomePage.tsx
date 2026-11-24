import { PageHeader } from '../../shared/ui/PageHeader'
import { useAppMeta } from './useAppMeta'

export function HomePage() {
  const { data, isPending, isError } = useAppMeta()

  return (
    <section>
      <PageHeader title="Home" />
      {isPending && <p>Loading backend info...</p>}
      {isError && <p role="alert">Could not reach the backend.</p>}
      {data && (
        <p>
          Backend: <span className="font-medium">{data.name}</span> version{' '}
          <span className="font-medium">{data.version}</span>
        </p>
      )}
    </section>
  )
}
