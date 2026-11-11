import { Router } from 'express';
import { z } from 'zod';
import type { Filter } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { ApiError, ColorEntry, Song, SongWithColors } from '@chromesthesia/shared';
import { requireOwner } from '../auth.js';
import { colors, songs, toColorEntry } from '../db.js';
import { addColorSchema, listQuerySchema, upsertSongSchema } from '../validation.js';

const router = Router();

type NoParams = Record<string, never>;
type IdParams = { id: string };

// Don't leak Mongo's _id; the Spotify track id is the public identifier
const withoutMongoId = { projection: { _id: 0 } } as const;

const songExists = async (id: string) => (await songs().countDocuments({ id }, { limit: 1 })) > 0;

// Song order: by where the part starts, then by when it was saved. Whole-song colors have no
// startMs, which Mongo sorts before any number, so they come first. Keep in step with
// compareColorEntries() in the client.
const colorsFor = async (songId: string): Promise<ColorEntry[]> => {
    const docs = await colors()
        .find({ songId })
        .sort({ startMs: 1, createdAt: 1, _id: 1 })
        .toArray();
    return docs.map(toColorEntry);
};

// List songs, optionally filtered by ?title= or ?artist=
router.get<NoParams, Song[] | ApiError>('/', async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });

    const filter: Filter<Song> = {};
    if (parsed.data.title) filter.title = parsed.data.title;
    if (parsed.data.artist) filter.artists = parsed.data.artist;

    const results = await songs().find(filter, withoutMongoId).limit(50).toArray();
    res.json(results);
});

// Get one song by Spotify track id, with its colors in song order
router.get<IdParams, SongWithColors | ApiError>('/:id', async (req, res) => {
    const song = await songs().findOne({ id: req.params.id }, withoutMongoId);
    if (!song) return res.status(404).json({ error: 'Song not found' });
    res.json({ ...song, colors: await colorsFor(song.id) });
});

// Create or update a song's metadata
router.put<IdParams, Song | ApiError>('/:id', requireOwner, async (req, res) => {
    const parsed = upsertSongSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: z.prettifyError(parsed.error) });
    }
    const song: Song = { id: req.params.id, ...parsed.data };

    // $set only touches the given fields, so drop an albumImageUrl the client no longer sends
    const update =
        song.albumImageUrl === undefined
            ? { $set: song, $unset: { albumImageUrl: '' as const } }
            : { $set: song };
    const result = await songs().updateOne({ id: song.id }, update, { upsert: true });
    // Read it back: notes the request left out are kept, so the body isn't the whole song
    const saved = await songs().findOne({ id: song.id }, withoutMongoId);
    res.status(result.upsertedCount ? 201 : 200).json(saved!);
});

// Get the colors for one song, in song order
router.get<IdParams, ColorEntry[] | ApiError>('/:id/colors', async (req, res) => {
    if (!(await songExists(req.params.id))) {
        return res.status(404).json({ error: 'Song not found' });
    }
    res.json(await colorsFor(req.params.id));
});

// Assign a color to a song or part of it
router.post<IdParams, ColorEntry | ApiError>('/:id/colors', requireOwner, async (req, res) => {
    const parsed = addColorSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: z.prettifyError(parsed.error) });
    }
    if (!(await songExists(req.params.id))) {
        return res.status(404).json({ error: 'Song not found' });
    }

    const doc = {
        _id: new ObjectId(),
        songId: req.params.id,
        ...parsed.data,
        createdAt: new Date(),
    };
    await colors().insertOne(doc);
    res.status(201).json(toColorEntry(doc));
});

export default router;
