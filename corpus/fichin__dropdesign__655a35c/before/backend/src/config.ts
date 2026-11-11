import { z } from 'zod'

// Values come from the environment; locally the npm scripts load backend/.env
const envSchema = z.object({
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is missing. Copy backend/.env.example to backend/.env and paste your Neon connection string.' })
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL should start with postgresql:// (copy it from the Neon dashboard)'),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
})

const parsed = envSchema.safeParse({
  ...process.env,
  // Treat an empty "DATABASE_URL=" line the same as a missing one
  DATABASE_URL: process.env.DATABASE_URL || undefined,
})

if (!parsed.success) {
  for (const issue of parsed.error.issues) console.error(`Config error: ${issue.message}`)
  process.exit(1)
}

export const config = parsed.data
