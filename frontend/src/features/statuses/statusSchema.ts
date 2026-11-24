import { z } from 'zod'
import { GROUPS } from './statusTypes'

const row = z.object({
  key: z.string(),
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Enter a name.').max(50, 'Use 1 to 50 characters.'),
  group: z.enum(GROUPS),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a color like #3b82f6.'),
})

/** FR-23: names 1 to 50 and unique, at least one Not started and one Done or Closed status. */
export const statusSetSchema = z.object({
  statuses: z.array(row).superRefine((rows, ctx) => {
    const seen = new Map<string, number>()
    rows.forEach((status, index) => {
      const name = status.name.trim().toLowerCase()
      if (!name) return
      if (seen.has(name)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'name'],
          message: 'Names must be unique within a set.',
        })
      }
      seen.set(name, index)
    })
    if (!rows.some((status) => status.group === 'NOT_STARTED')) {
      ctx.addIssue({ code: 'custom', message: 'A set needs at least one Not started status.' })
    }
    if (!rows.some((status) => status.group === 'DONE' || status.group === 'CLOSED')) {
      ctx.addIssue({ code: 'custom', message: 'A set needs at least one Done or Closed status.' })
    }
  }),
})

export type StatusSetForm = z.infer<typeof statusSetSchema>
