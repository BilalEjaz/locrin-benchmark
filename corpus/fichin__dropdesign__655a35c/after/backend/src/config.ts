import { z } from 'zod'

// Values come from the environment; locally the npm scripts load backend/.env.
// Each entry point loads only what it needs: migrate/seed don't need JWT_SECRET.

const databaseUrl = z
  .string({ error: 'DATABASE_URL is missing. Copy backend/.env.example to backend/.env and paste your Neon connection string.' })
  .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL should start with postgresql:// (copy it from the Neon dashboard)')

const serverSchema = z.object({
  DATABASE_URL: databaseUrl,
  JWT_SECRET: z
    .string({ error: 'JWT_SECRET is missing. Set it in backend/.env (see .env.example for how to generate one).' })
    .min(32, 'JWT_SECRET should be at least 32 characters (see .env.example for how to generate one)'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
})

function load<T extends z.ZodType>(schema: T): z.infer<T> {
  // Treat empty "NAME=" lines the same as missing ones
  const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''))
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) console.error(`Config error: ${issue.message}`)
    process.exit(1)
  }
  return parsed.data
}

/** Everything the API server needs */
export const loadServerConfig = () => load(serverSchema)

/** Just the database, for scripts like migrate and seed */
export const loadDatabaseUrl = () => load(z.object({ DATABASE_URL: databaseUrl })).DATABASE_URL
