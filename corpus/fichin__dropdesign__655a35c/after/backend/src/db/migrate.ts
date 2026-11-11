// Usage: npm run migrate
import { loadDatabaseUrl } from '../config.ts'
import { runMigrations } from './migrations.ts'
import { createPool } from './pool.ts'

const pool = createPool(loadDatabaseUrl())
try {
  const applied = await runMigrations(pool)
  for (const file of applied) console.log(`Applied ${file}`)
  if (applied.length === 0) console.log('Database is up to date.')
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
} finally {
  await pool.end()
}
