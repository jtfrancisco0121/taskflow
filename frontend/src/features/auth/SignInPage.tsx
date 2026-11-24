import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { api } from '../../api/client'
import { ApiError, messageOf, unwrap } from '../../api/errors'
import { setSession } from '../../api/session'
import { AuthCard } from '../../shared/ui/AuthCard'
import { Button } from '../../shared/ui/Button'
import { TextField } from '../../shared/ui/TextField'
import { signInSchema, type SignInValues } from './authForms'
import { useSession } from './useSession'

type FromState = { from?: { pathname: string; search?: string; hash?: string }; ended?: boolean }

export function SignInPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as FromState
  const session = useSession()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  })
  const { errors, isSubmitting } = form.formState

  const target = state.from
    ? `${state.from.pathname}${state.from.search ?? ''}${state.from.hash ?? ''}`
    : '/'

  if (session.status === 'authenticated') return <Navigate to={target} replace />

  const submit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      const auth = await unwrap(
        api.POST('/api/v1/auth/signin', {
          body: { email: values.email, password: values.password },
        }),
      )
      if (!auth.accessToken) throw new ApiError({ status: 500 })
      setSession(auth.accessToken, auth.user ?? null)
      void navigate(target, { replace: true })
    } catch (err) {
      form.resetField('password')
      if (err instanceof ApiError && err.status === 429) {
        setFormError('Too many attempts. Try again later.')
      } else if (err instanceof ApiError && (err.status === 401 || err.status === 400)) {
        setFormError('Wrong email or password.')
      } else {
        setFormError(messageOf(err))
      }
    }
  })

  return (
    <AuthCard title="Sign in">
      {state.ended && (
        <p role="status" className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-900">
          Your session ended. Sign in again.
        </p>
      )}
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
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
          autoComplete="current-password"
          error={errors.password?.message}
          {...form.register('password')}
        />
        {formError && (
          <p role="alert" className="text-sm text-red-700">
            {formError}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          Sign in
        </Button>
      </form>
      <p className="mt-4 text-sm">
        <Link to="/signup" className="text-blue-700 underline">
          Create an account
        </Link>
      </p>
    </AuthCard>
  )
}
