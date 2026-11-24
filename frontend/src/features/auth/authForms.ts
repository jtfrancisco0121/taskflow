import { z } from 'zod'

export const signInSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email.'),
  password: z.string().min(1, 'Enter your password.'),
})

export const signUpSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter your name.').max(100, 'Use at most 100 characters.'),
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email.')
    .max(254, 'Use at most 254 characters.')
    .pipe(z.email('Enter a valid email address.')),
  password: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .max(128, 'Use at most 128 characters.'),
})

export type SignInValues = z.infer<typeof signInSchema>
export type SignUpValues = z.infer<typeof signUpSchema>
