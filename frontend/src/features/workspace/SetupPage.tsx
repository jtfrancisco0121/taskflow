import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { messageOf } from '../../api/errors'
import { Button } from '../../shared/ui/Button'
import { TextField } from '../../shared/ui/TextField'
import { useCreateWorkspace } from './useCreateWorkspace'

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(100, 'Use at most 100 characters.'),
  key: z
    .string()
    .trim()
    .refine((value) => value === '' || /^[A-Z]{2,6}$/.test(value), 'Use 2 to 6 capital letters.'),
})
type Values = z.infer<typeof schema>

/** FR-6: create a Workspace (name and an optional key for readable task ids). */
export function SetupPage() {
  const create = useCreateWorkspace()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', key: '' },
  })
  const { errors } = form.formState
  const nameField = form.register('name')

  useEffect(() => form.setFocus('name'), [form])

  const submit = form.handleSubmit((values) => {
    create.mutate({ name: values.name, ...(values.key ? { key: values.key } : {}) })
  })

  return (
    <div className="mx-auto mt-10 w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6">
      <h1 className="mb-4 text-xl font-semibold">Create your Workspace</h1>
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <TextField label="Name" error={errors.name?.message} {...nameField} />
        <TextField
          label="Key (optional)"
          placeholder="ACME"
          error={errors.key?.message}
          {...form.register('key')}
        />
        {create.isError && (
          <p role="alert" className="text-sm text-red-700">
            {messageOf(create.error)}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={create.isPending}>
          Create Workspace
        </Button>
      </form>
    </div>
  )
}
