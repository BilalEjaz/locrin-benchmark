import { z } from 'zod';
import type {
    AddColorRequest,
    LoginRequest,
    UpdateColorRequest,
    UpsertSongRequest,
} from '@chromesthesia/shared';

// Accepts #rgb or #rrggbb in any case; stores lowercase #rrggbb so "#FFF" and "#ffffff" match
export const hexColor = z
    .string()
    .regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i, 'Expected a color like #ff8800')
    .transform((hex) => {
        const digits = hex.slice(1).toLowerCase();
        return digits.length === 3 ? `#${[...digits].map((d) => d + d).join('')}` : `#${digits}`;
    });

// Short descriptors such as "glossy"; blank and repeated notes are rejected
export const notes = z
    .array(z.string().trim().min(1).max(200))
    .max(20)
    .refine((n) => new Set(n).size === n.length, 'Notes must not repeat');

const ms = z.number().int().nonnegative();

const album = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    url: z.url(),
    releaseDate: z
        .string()
        .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'Expected YYYY, YYYY-MM or YYYY-MM-DD'),
    releaseDatePrecision: z.enum(['year', 'month', 'day']),
    type: z.enum(['album', 'single', 'compilation']),
});

export const upsertSongSchema = z.object({
    title: z.string().min(1),
    artists: z.array(z.string()),
    albumImageUrl: z.url().optional(),
    songUrl: z.url(),
    durationMs: ms.positive().optional(),
    notes: notes.optional(),
    album: album.optional(),
    artistUrls: z.array(z.url()).optional(),
}) satisfies z.ZodType<UpsertSongRequest>;

const label = z.string().trim().min(1).max(50);

/** Why a part's times are invalid, or undefined when they're fine (both missing is whole-song). */
export const partError = (startMs?: number, endMs?: number): string | undefined => {
    if ((startMs === undefined) !== (endMs === undefined)) {
        return 'startMs and endMs must be given together';
    }
    if (startMs !== undefined && endMs! <= startMs) return 'endMs must be greater than startMs';
    return undefined;
};

export const addColorSchema = z
    .object({
        color: hexColor,
        startMs: ms.optional(),
        endMs: ms.optional(),
        label: label.optional(),
        notes: notes.optional(),
    })
    .superRefine((c, ctx) => {
        const message = partError(c.startMs, c.endMs);
        if (message) ctx.addIssue({ code: 'custom', message, path: ['endMs'] });
    }) satisfies z.ZodType<AddColorRequest>;

// Times are checked against the stored entry once merged, in the route, with partError()
export const updateColorSchema = z
    .strictObject({
        color: hexColor.optional(),
        startMs: ms.nullable().optional(),
        endMs: ms.nullable().optional(),
        label: label.nullable().optional(),
        notes: notes.nullable().optional(),
    })
    .refine(
        (c) => Object.keys(c).length > 0,
        'Nothing to update',
    ) satisfies z.ZodType<UpdateColorRequest>;

// Only these query params are passed through to Mongo, and only as plain strings.
// Passing req.query straight to find() would let ?field[$ne]=x inject operators.
export const listQuerySchema = z.object({
    title: z.string().optional(),
    artist: z.string().optional(),
});

export const loginSchema = z.object({
    password: z.string().min(1).max(1024),
}) satisfies z.ZodType<LoginRequest>;
