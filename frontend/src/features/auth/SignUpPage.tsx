import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate } from 'react-router'
import { api } from '../../api/client'
import { ApiError, messageOf, unwrap } from '../../api/errors'
import { setSession } from '../../api/session'
import { AuthCard } from '../../shared/ui/AuthCard'
import { Button } from '../../shared/ui/Button'
import { TextField } from '../../shared/ui/TextField'
import { signUpSchema, type SignUpValues } from './authForms'
import { useSession } from './useSession'

export function SignUpPage() {
  const navigate = useNavigate()
  const session = useSession()
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const form = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { displayName: '', email: '', password: '' },
  })
  const { errors, isSubmitting } = form.formState

  if (session.status === 'authenticated' && !done) return <Navigate to="/" replace />

  const submit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      const auth = await unwrap(api.POST('/api/v1/auth/signup', { body: values }))
      if (!auth.accessToken) throw new ApiError({ status: 500 })
      setDone(true)
      setSession(auth.accessToken, auth.user ?? null)
      void navigate('/setup', { replace: true })
    } catch (err) {
      // Name, email and password stay filled so the user can correct and resubmit.
      setFormError(
        err instanceof ApiError && err.status === 429
          ? 'Too many attempts. Try again later.'
          : messageOf(err),
      )
    }
  })

  return (
    <AuthCard title="Create an account">
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <TextField
          label="Display name"
          autoComplete="name"
          error={errors.displayName?.message}
          {...form.register('displayName')}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          error={errors.password?.message}
          {...form.register('password')}
        />
        {formError && (
          <p role="alert" className="text-sm text-red-700">
            {formError}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          Create account
        </Button>
      </form>
      <p className="mt-4 text-sm">
        <Link to="/signin" className="text-blue-700 underline">
          I already have an account
        </Link>
      </p>
    </AuthCard>
  )
}
