// Local development without Postgres: the whole server on an in-memory database (data is gone after a restart). `node src/dev-memory.ts`
import { createServer } from 'node:http';
import { newDb } from 'pg-mem';
import { SCHEMA, type Db } from './db.ts';
import { CandleStore, makeProvider } from './candles.ts';
import { createApp } from './app.ts';
import { makeVault } from './vault.ts';

const mem = newDb();
mem.public.none(SCHEMA);
const pool = new (mem.adapters.createPg().Pool)();
const db: Db = { query: (sql, params) => pool.query(sql, params as any[]) };
const port = Number(process.env.PORT ?? 8787);
createServer(createApp({ db, candles: new CandleStore(db, makeProvider(null)), allowSignup: true, vault: makeVault('dev-only-secret-0123456789') })).listen(port, () => console.log(`oviate dev server (memory) on :${port}`));
