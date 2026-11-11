import 'express-async-errors';
import express, { type ErrorRequestHandler } from 'express';
import songs from './routes/songs.js';
import colors from './routes/colors.js';
import { authRouter } from './routes/auth.js';
import type { AuthConfig } from './auth.js';

/**
 * Builds the Express app without starting it, so tests can drive it directly. The owner login
 * config is passed in rather than read from the env, so tests can use known values.
 */
export function createApp(auth: AuthConfig) {
    const app = express();
    // Read by requireOwner and the auth routes
    app.locals.auth = auth;

    app.use(express.json());

    app.use('/api/auth', authRouter());
    app.use('/api/songs', songs);
    app.use('/api/colors', colors);

    // Unknown API routes
    app.use('/api', (_req, res) => {
        res.status(404).json({ error: 'Not found' });
    });

    const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
        // Malformed JSON bodies come through here from express.json()
        if (err?.type === 'entity.parse.failed') {
            res.status(400).json({ error: 'Invalid JSON body' });
            return;
        }
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
    };
    app.use(errorHandler);

    return app;
}
