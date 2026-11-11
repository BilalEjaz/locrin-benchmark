import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { colors, songs } from '../db.js';
import { useTestDb } from '../test/db.js';

useTestDb();
const app = createApp();

const id = '1XZPtZVqcOzzxbYIR7MjQw';
const song = {
    title: 'Ontario',
    artists: ['Novo Amor', 'Lowswimmer'],
    songUrl: 'https://open.spotify.com/track/1XZPtZVqcOzzxbYIR7MjQw',
    albumImageUrl: 'https://i.scdn.co/image/abc',
};

const putSong = (body: object = song, songId = id) =>
    request(app).put(`/api/songs/${songId}`).send(body);
const addColor = (body: object, songId = id) =>
    request(app).post(`/api/songs/${songId}/colors`).send(body);

describe('PUT /api/songs/:id', () => {
    it('creates a song with 201', async () => {
        const res = await putSong();

        expect(res.status).toBe(201);
        expect(res.body).toEqual({ id, ...song });
        expect(res.body).not.toHaveProperty('_id');
    });

    it('updates an existing song with 200 without duplicating it', async () => {
        await putSong();
        const res = await putSong({ ...song, title: 'Ontario (Remastered)' });

        expect(res.status).toBe(200);
        expect(res.body.title).toBe('Ontario (Remastered)');
        expect(await songs().countDocuments()).toBe(1);
    });

    it('removes albumImageUrl when it is no longer sent', async () => {
        await putSong();
        await putSong({ ...song, albumImageUrl: undefined });

        expect(await songs().findOne({ id })).not.toHaveProperty('albumImageUrl');
    });

    it('stores durationMs and keeps it when a save leaves it out', async () => {
        await putSong({ ...song, durationMs: 215000 });
        const res = await putSong();

        expect(res.body.durationMs).toBe(215000);
        expect((await putSong({ ...song, durationMs: 0 })).status).toBe(400);
    });

    it('keeps notes when a save leaves them out, and clears them with []', async () => {
        await putSong({ ...song, notes: ['glossy'] });
        const res = await putSong();
        expect(res.body.notes).toEqual(['glossy']);

        await putSong({ ...song, notes: [] });
        expect((await songs().findOne({ id }))?.notes).toEqual([]);
    });

    const album = {
        id: '3kEtdS2pH6hKcMU9Wioob1',
        name: 'Strange Trails',
        url: 'https://open.spotify.com/album/3kEtdS2pH6hKcMU9Wioob1',
        releaseDate: '2015-04-07',
        releaseDatePrecision: 'day',
        type: 'album',
    };
    const artistUrls = ['https://open.spotify.com/artist/a', 'https://open.spotify.com/artist/b'];

    it('stores the album and artist links and keeps them when a save leaves them out', async () => {
        await putSong({ ...song, album, artistUrls });
        const res = await putSong();

        expect(res.body.album).toEqual(album);
        expect(res.body.artistUrls).toEqual(artistUrls);
    });

    it.each([
        ['a bad release date', { ...album, releaseDate: '7 April 2015' }],
        ['an unknown album type', { ...album, type: 'ep' }],
        ['a missing album name', { ...album, name: undefined }],
    ])('rejects an album with %s with 400', async (_name, badAlbum) => {
        expect((await putSong({ ...song, album: badAlbum })).status).toBe(400);
    });

    it('rejects invalid song notes with 400', async () => {
        const res = await putSong({ ...song, notes: ['glossy', ' glossy '] });
        expect(res.status).toBe(400);
    });

    it('enforces one document per song id', async () => {
        await putSong();
        await expect(songs().insertOne({ id, ...song })).rejects.toThrow(/duplicate key/);
    });

    it.each([
        ['a missing title', { ...song, title: undefined }],
        ['a non-URL songUrl', { ...song, songUrl: 'nope' }],
        ['non-array artists', { ...song, artists: 'Novo Amor' }],
    ])('rejects %s with 400', async (_label, body) => {
        const res = await putSong(body);

        expect(res.status).toBe(400);
        expect(res.body.error).toEqual(expect.any(String));
        expect(await songs().countDocuments()).toBe(0);
    });

    it('rejects malformed JSON with 400', async () => {
        const res = await request(app)
            .put(`/api/songs/${id}`)
            .set('Content-Type', 'application/json')
            .send('{"title":');

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid JSON body' });
    });
});

describe('POST /api/songs/:id/colors', () => {
    it('adds a color entry with 201', async () => {
        await putSong();
        const res = await addColor({ color: '#ff0000' });

        expect(res.status).toBe(201);
        expect(res.body).toEqual({
            id: expect.stringMatching(/^[0-9a-f]{24}$/),
            songId: id,
            color: '#ff0000',
            createdAt: expect.any(String),
        });
        expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt);
        expect(await colors().countDocuments({ songId: id })).toBe(1);
    });

    it('stores a song part with its range, label and notes', async () => {
        await putSong();
        const part = {
            color: '#00ff00',
            startMs: 1000,
            endMs: 5000,
            label: 'chorus',
            notes: ['glossy'],
        };
        const res = await addColor(part);

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject(part);
    });

    it('keeps duplicate colors as separate entries', async () => {
        await putSong();
        await addColor({ color: '#ff0000' });
        await addColor({ color: '#ff0000' });

        expect(await colors().countDocuments({ songId: id })).toBe(2);
    });

    it('normalizes colors to lowercase #rrggbb', async () => {
        await putSong();
        const res = await addColor({ color: '#F0A' });

        expect(res.body.color).toBe('#ff00aa');
    });

    it('returns 404 for an unknown song', async () => {
        const res = await addColor({ color: '#ff0000' }, 'missing');

        expect(res.status).toBe(404);
        expect(await colors().countDocuments()).toBe(0);
    });

    it.each([
        ['an invalid color', { color: 'red' }],
        ['startMs without endMs', { color: '#fff', startMs: 1000 }],
        ['endMs without startMs', { color: '#fff', endMs: 1000 }],
        ['endMs before startMs', { color: '#fff', startMs: 5000, endMs: 1000 }],
        ['an empty range', { color: '#fff', startMs: 1000, endMs: 1000 }],
        ['a negative startMs', { color: '#fff', startMs: -1, endMs: 1000 }],
        ['a fractional endMs', { color: '#fff', startMs: 0, endMs: 1.5 }],
        ['a blank label', { color: '#fff', label: '   ' }],
        ['a label over 50 chars', { color: '#fff', label: 'x'.repeat(51) }],
        ['a blank note', { color: '#fff', notes: [' '] }],
        ['a note over 200 chars', { color: '#fff', notes: ['x'.repeat(201)] }],
        ['repeated notes', { color: '#fff', notes: ['glossy', 'glossy'] }],
        ['a string instead of a notes list', { color: '#fff', notes: 'glossy' }],
    ])('rejects %s with 400', async (_label, body) => {
        await putSong();
        const res = await addColor(body);

        expect(res.status).toBe(400);
        expect(res.body.error).toEqual(expect.any(String));
        expect(await colors().countDocuments()).toBe(0);
    });
});

describe('GET /api/songs', () => {
    const otherId = 'other';

    const seed = async () => {
        await putSong();
        await putSong({ ...song, title: 'Other', artists: ['Someone'] }, otherId);
        await addColor({ color: '#ff0000' });
        await addColor({ color: '#00ff00', startMs: 0, endMs: 1000 });
        await addColor({ color: '#0000ff' }, otherId);
    };

    it('gets one song by id with its colors, oldest first', async () => {
        await seed();
        const res = await request(app).get(`/api/songs/${id}`);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id, ...song });
        expect(res.body.colors.map((c: { color: string }) => c.color)).toEqual([
            '#ff0000',
            '#00ff00',
        ]);
    });

    it("gets a song's colors, oldest first", async () => {
        await seed();
        const res = await request(app).get(`/api/songs/${id}/colors`);

        expect(res.status).toBe(200);
        expect(res.body.map((c: { color: string }) => c.color)).toEqual(['#ff0000', '#00ff00']);
    });

    it('orders colors by where they start in the song, then by when they were saved', async () => {
        await putSong();
        // Saved in this order; each is a [color, startMs, endMs] (no range = whole song)
        const saved: [string, number?, number?][] = [
            ['#000005', 5000, 9000],
            ['#00000a', undefined, undefined],
            ['#000001', 1000, 3000],
            ['#000002', 1000, 2000], // same start as #000001: saved later, so after it
            ['#000000', 0, 500],
            ['#00000b', undefined, undefined],
        ];
        for (const [color, startMs, endMs] of saved) await addColor({ color, startMs, endMs });

        const expected = ['#00000a', '#00000b', '#000000', '#000001', '#000002', '#000005'];
        const list = await request(app).get(`/api/songs/${id}/colors`);
        const one = await request(app).get(`/api/songs/${id}`);
        expect(list.body.map((c: { color: string }) => c.color)).toEqual(expected);
        expect(one.body.colors.map((c: { color: string }) => c.color)).toEqual(expected);
    });

    it('returns an empty list for a song with no colors', async () => {
        await putSong();
        const res = await request(app).get(`/api/songs/${id}/colors`);

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('returns 404 for an unknown song', async () => {
        expect((await request(app).get('/api/songs/missing')).status).toBe(404);
        expect((await request(app).get('/api/songs/missing/colors')).status).toBe(404);
    });

    it('lists songs without embedding colors', async () => {
        await seed();
        const res = await request(app).get('/api/songs');

        expect(res.body).toHaveLength(2);
        expect(res.body[0]).not.toHaveProperty('colors');
        expect(res.body[0]).not.toHaveProperty('_id');
    });

    it('filters the list by artist', async () => {
        await seed();
        const res = await request(app).get('/api/songs').query({ artist: 'Lowswimmer' });

        expect(res.body.map((s: { id: string }) => s.id)).toEqual([id]);
    });

    it('rejects Mongo operators in query params', async () => {
        const res = await request(app).get('/api/songs?title[$ne]=x');
        expect(res.status).toBe(400);
    });
});

it('no longer accepts POST /api/songs', async () => {
    const res = await request(app)
        .post('/api/songs')
        .send({ id, ...song, color: '#ff0000' });
    expect(res.status).toBe(404);
});

it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
});
