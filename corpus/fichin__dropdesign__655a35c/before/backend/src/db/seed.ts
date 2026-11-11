// Loads the sample board (shared/sampleBoard.ts) into the database.
// Usage: npm run seed            — only if the database has no boards yet
//        npm run seed -- --reset — deletes ALL boards, tasks and people first
import { initialBoard } from '../../../shared/sampleBoard.ts'
import { config } from '../config.ts'
import { createPool, withTransaction } from './pool.ts'
import { insertSampleBoard } from './sampleData.ts'

const reset = process.argv.includes('--reset')
const pool = createPool(config.DATABASE_URL)

try {
  const boardId = await withTransaction(pool, async (client) => {
    if (reset) {
      await client.query('TRUNCATE boards, people CASCADE')
    } else {
      const { rows } = await client.query<{ count: string }>('SELECT count(*) FROM boards')
      if (Number(rows[0].count) > 0) return null
    }
    return insertSampleBoard(client)
  })

  if (boardId) {
    console.log(`Seeded "${initialBoard.title}" (${boardId}).`)
  } else {
    console.log('The database already has a board, so nothing was changed.')
    console.log('To wipe it and start over: npm run seed -- --reset')
  }
} catch (error) {
  console.error('Seeding failed:', (error as Error).message)
  process.exitCode = 1
} finally {
  await pool.end()
}
