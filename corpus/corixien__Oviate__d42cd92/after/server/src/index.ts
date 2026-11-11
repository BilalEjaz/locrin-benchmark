import { createServer } from 'node:http';
import { connect, migrate } from './db.ts';
import { CandleStore, makeProvider } from './candles.ts';
import { createApp } from './app.ts';
import { makeVault } from './vault.ts';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set (Neon connection string)'); process.exit(1); }
const db = connect(url);
await migrate(db);

const keys = process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET ? { id: process.env.ALPACA_KEY_ID, secret: process.env.ALPACA_SECRET } : null;
const app = createApp({ db, candles: new CandleStore(db, makeProvider(keys)), allowSignup: process.env.ALLOW_SIGNUP !== 'false', vault: process.env.SECRETS_KEY && process.env.SECRETS_KEY.length >= 16 ? makeVault(process.env.SECRETS_KEY) : null });
if (!process.env.SECRETS_KEY) console.warn('SECRETS_KEY is not set: API keys are not synced (set a long random value)');
const port = Number(process.env.PORT ?? 8787);
createServer(app).listen(port, () => console.log(`oviate server on :${port} (${keys ? 'Alpaca + Yahoo' : 'Yahoo only'})`));
process.on('unhandledRejection', (e) => console.error('unhandled rejection', e));
