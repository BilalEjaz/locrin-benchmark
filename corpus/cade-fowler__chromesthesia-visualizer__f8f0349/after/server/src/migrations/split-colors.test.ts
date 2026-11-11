import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, ObjectId, type Db, type Document } from 'mongodb';
import { testApp } from '../test/auth.js';
import { connectDb, disconnectDb, ensureIndexes } from '../db.js';
import { legacySongs } from '../test/legacy-songs.js';
import { migrateSplitColors } from './split-colors.js';

// This suite drives the DB directly instead of using useTestDb(): connectDb() creates the
// unique songs.id index, which would stop us seeding the duplicates old databases can have.
let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    client = await MongoClient.connect(mongo.getUri());
});

afterAll(async () => {
    await client.close();
    await mongo.stop();
});

beforeEach(async () => {
    db = client.db(`migration-${new ObjectId().toHexString()}`);
});

const songs = () => db.collection<Document>('songs');
const colors = () => db.collection<Document>('colors');
// Shallow copies: insertMany adds fields to what it's given, and structuredClone would
// turn ObjectIds into plain objects
const seed = () => songs().insertMany(legacySongs.map((s) => ({ ...s })));
const findSong = (id: string) => songs().findOne({ id }, { projection: { _id: 0 } });
const colorsOf = async (songId: string) =>
    (await colors().find({ songId }).sort({ _id: 1 }).toArray()).map((c) => c.color);

const FEEL_GOOD = '0d28khcov6AiegSCpG5TuT';
const PAUL_REVERE = '1dHtMSJ1Ozg2Ja6GX4McAO';
const LION_MAN = '2kXjRzwcTZhGLnVjUud8l3';
const HORSE = '54eZmuggBFJbV7k248bTTt';

describe('migrateSplitColors', () => {
    it('reshapes raw Spotify songs and drops their extra fields', async () => {
        await seed();
        const report = await migrateSplitColors(db);

        expect(await findSong(FEEL_GOOD)).toEqual({
            id: FEEL_GOOD,
            title: 'Feel Good Inc.',
            artists: ['Gorillaz'],
            songUrl: 'https://open.spotify.com/track/0d28khcov6AiegSCpG5TuT',
        });
        expect(report.reshaped).toContainEqual({
            id: FEEL_GOOD,
            dropped: ['album', 'external_urls', 'name', 'popularity'],
        });
    });

    it('turns embedded colors into entries, normalized and in their original order', async () => {
        await seed();
        await migrateSplitColors(db);

        expect(await colorsOf(FEEL_GOOD)).toEqual(['#001122', '#00ffff', '#105070', '#691738']);
        expect(await colorsOf(LION_MAN)).toEqual([
            '#ffffff',
            '#f4f4f4',
            '#d4d4d4',
            '#bcbcbc',
            '#a2a2a2',
            '#868686',
            '#717171',
            '#5b5b5b',
        ]);
        expect(await songs().countDocuments({ colors: { $exists: true } })).toBe(0);
    });

    it('dates entries from when the song was first saved', async () => {
        await seed();
        await migrateSplitColors(db);

        const entry = await colors().findOne({ songId: FEEL_GOOD });
        expect(entry?.createdAt).toEqual(legacySongs[0]._id.getTimestamp());
        expect(entry?.createdAt.toISOString().slice(0, 10)).toBe('2024-06-04');
        expect(entry?.migratedAt).toBeInstanceOf(Date);
    });

    it('keeps song notes on the song and trims artist names', async () => {
        await seed();
        await migrateSplitColors(db);

        expect((await findSong(PAUL_REVERE))?.notes).toEqual(['Glossy']);
        expect((await findSong(HORSE))?.artists).toEqual(['America', 'George Martin']);
    });

    it('produces songs and colors the API serves', async () => {
        await seed();
        await migrateSplitColors(db);

        await connectDb(mongo.getUri(), db.databaseName);
        try {
            const res = await request(testApp()).get(`/api/songs/${PAUL_REVERE}`);
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ title: 'Paul Revere', notes: ['Glossy'] });
            expect(res.body.colors.map((c: { color: string }) => c.color)).toEqual([
                '#4c1767',
                '#111012',
            ]);
            expect(res.body.colors[0]).not.toHaveProperty('migratedAt');
        } finally {
            await disconnectDb();
        }
    });

    it('writes nothing on a dry run, but reports what it would do', async () => {
        await seed();
        const report = await migrateSplitColors(db, { dryRun: true });

        expect(report).toMatchObject({ dryRun: true, songsScanned: 5, colorsCreated: 16 });
        expect(report.converted).toHaveLength(5);
        // Only songs whose fields change count as reshaped, not every song that had colors
        expect(report.reshaped.map((r) => r.id).sort()).toEqual(
            ['0QZ5yyl6B6utIWkxeBDxQN', FEEL_GOOD, HORSE].sort(),
        );
        expect(await colors().countDocuments()).toBe(0);
        expect(await songs().countDocuments({ colors: { $exists: true } })).toBe(5);
    });

    it('is a no-op the second time', async () => {
        await seed();
        await migrateSplitColors(db);
        const before = await colors().find().toArray();

        const report = await migrateSplitColors(db);

        expect(report).toMatchObject({ converted: [], reshaped: [], merged: [], skipped: [] });
        expect(await colors().find().toArray()).toEqual(before);
    });

    it('recovers from a run interrupted after writing entries', async () => {
        await seed();
        await migrateSplitColors(db);
        // Simulate a crash before the song's embedded colors were removed
        await songs().updateOne({ id: FEEL_GOOD }, { $set: { colors: ['#001122', '#00FFFF'] } });

        await migrateSplitColors(db);

        expect(await colorsOf(FEEL_GOOD)).toEqual(['#001122', '#00ffff']);
    });

    it('leaves colors added after the migration alone', async () => {
        await songs().insertOne({ ...legacySongs[2] });
        await migrateSplitColors(db);
        await colors().insertOne({ songId: PAUL_REVERE, color: '#abcdef', createdAt: new Date() });
        await songs().updateOne({ id: PAUL_REVERE }, { $set: { colors: ['#4c1767'] } });

        await migrateSplitColors(db);

        expect(await colorsOf(PAUL_REVERE)).toEqual(['#abcdef', '#4c1767']);
    });

    it('merges duplicate documents for one song into the oldest', async () => {
        const [older, newer] = [new ObjectId(), new ObjectId()];
        const base = {
            id: 'dup',
            title: 'Dup',
            artists: ['A'],
            songUrl: 'https://open.spotify.com/track/dup',
        };
        await songs().insertMany([
            { _id: older, ...base, colors: ['#ff0000', '#00ff00'] },
            {
                _id: newer,
                ...base,
                albumImageUrl: 'https://i.scdn.co/x',
                colors: ['#00FF00', '#0000ff'],
            },
        ]);

        const report = await migrateSplitColors(db);

        expect(report.merged).toEqual([{ id: 'dup', removed: 1 }]);
        expect(await songs().find({ id: 'dup' }).toArray()).toEqual([
            { _id: older, ...base, albumImageUrl: 'https://i.scdn.co/x' },
        ]);
        expect(await colorsOf('dup')).toEqual(['#ff0000', '#00ff00', '#0000ff']);
        await expect(ensureIndexes(db)).resolves.toBeUndefined();
    });

    it.each([
        ['an invalid color', { colors: ['#ff0000', 'red'] }, 'invalid color "red"'],
        ['colors that are not a list', { colors: '#ff0000' }, 'colors is not a list'],
        ['a missing title', { title: undefined }, 'title'],
        ['a non-URL songUrl', { songUrl: 'nope' }, 'songUrl'],
    ])('skips a song with %s and leaves it untouched', async (_label, change, reason) => {
        const fields = {
            _id: new ObjectId(),
            id: 'bad',
            title: 'Bad',
            artists: ['A'],
            songUrl: 'https://open.spotify.com/track/bad',
            colors: ['#ff0000'],
            ...change,
        };
        const doc = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
        await songs().insertOne({ ...doc });

        const report = await migrateSplitColors(db);

        expect(report.skipped).toEqual([{ id: 'bad', reason: expect.stringContaining(reason) }]);
        expect(await songs().findOne({ id: 'bad' })).toEqual(doc);
        expect(await colors().countDocuments()).toBe(0);
    });
});
