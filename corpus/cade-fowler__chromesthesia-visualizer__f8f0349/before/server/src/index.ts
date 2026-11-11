import 'dotenv/config';
import { createApp } from './app.js';
import { connectDb, songs } from './db.js';

const connectionString = process.env.CONNECTION_STRING;
if (!connectionString) {
    throw new Error('CONNECTION_STRING is not set. Copy server/.env.example to server/.env.');
}
const PORT = Number(process.env.PORT) || 5050;

await connectDb(connectionString, process.env.DB_NAME || 'colordatabase');

// Songs from before the colors collection still embed their colors, which the API ignores
if (await songs().countDocuments({ colors: { $exists: true } }, { limit: 1 })) {
    console.warn(
        'Some songs still embed their colors and will show none. ' +
            'Run: npm run migrate:split-colors -w server',
    );
}

createApp().listen(PORT, () => {
    console.log(`Server is running on port: ${PORT}`);
});
