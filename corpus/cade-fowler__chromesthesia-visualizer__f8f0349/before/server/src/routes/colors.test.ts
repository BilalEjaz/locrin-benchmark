import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { ObjectId } from 'mongodb';
import { createApp } from '../app.js';
import { colors } from '../db.js';
import { useTestDb } from '../test/db.js';

useTestDb();
const app = createApp();

const id = '1XZPtZVqcOzzxbYIR7MjQw';

const seedColor = async (color: string, extra: object = {}) => {
    await request(app)
        .put(`/api/songs/${id}`)
        .send({
            title: 'Ontario',
            artists: ['Novo Amor'],
            songUrl: 'https://open.spotify.com/track/1XZPtZVqcOzzxbYIR7MjQw',
        });
    const res = await request(app)
        .post(`/api/songs/${id}/colors`)
        .send({ color, ...extra });
    return res.body.id as string;
};

const patch = (colorId: string, body: object) =>
    request(app).patch(`/api/colors/${colorId}`).send(body);

describe('PATCH /api/colors/:id', () => {
    it('changes only the given fields', async () => {
        const colorId = await seedColor('#ff0000', { label: 'verse', notes: ['glossy'] });
        const before = await colors().findOne({ _id: new ObjectId(colorId) });

        const res = await patch(colorId, { startMs: 1000, endMs: 5000, label: 'chorus' });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            id: colorId,
            songId: id,
            color: '#ff0000',
            startMs: 1000,
            endMs: 5000,
            label: 'chorus',
            notes: ['glossy'],
            createdAt: before!.createdAt.toISOString(),
        });
        const stored = await request(app).get(`/api/songs/${id}/colors`);
        expect(stored.body).toEqual([res.body]);
    });

    it('normalizes the color', async () => {
        const colorId = await seedColor('#ff0000');
        const res = await patch(colorId, { color: '#ABC' });
        expect(res.body.color).toBe('#aabbcc');
    });

    it('clears fields set to null, turning a part back into a whole-song color', async () => {
        const colorId = await seedColor('#ff0000', {
            startMs: 0,
            endMs: 1000,
            label: 'intro',
            notes: ['glossy'],
        });

        const res = await patch(colorId, { startMs: null, endMs: null, label: null, notes: null });

        expect(res.status).toBe(200);
        for (const field of ['startMs', 'endMs', 'label', 'notes']) {
            expect(res.body).not.toHaveProperty(field);
        }
        const stored = await colors().findOne({ _id: new ObjectId(colorId) });
        expect(stored).not.toHaveProperty('startMs');
        expect(stored).not.toHaveProperty('label');
    });

    it('checks the times after merging with the stored entry', async () => {
        const whole = await seedColor('#ff0000');
        const part = await seedColor('#00ff00', { startMs: 1000, endMs: 5000 });

        expect((await patch(whole, { startMs: 1000 })).status).toBe(400);
        expect((await patch(part, { endMs: 500 })).status).toBe(400);
        expect((await patch(part, { startMs: null })).status).toBe(400);
        expect((await patch(part, { endMs: 9000 })).status).toBe(200);
    });

    it.each([
        ['an empty body', {}],
        ['an unknown field', { songId: 'other' }],
        ['a bad color', { color: 'red' }],
        ['a negative time', { startMs: -1, endMs: 10 }],
        ['a blank label', { label: ' ' }],
    ])('rejects %s with 400', async (_name, body) => {
        const colorId = await seedColor('#ff0000');
        const res = await patch(colorId, body);
        expect(res.status).toBe(400);
        expect((await colors().findOne({ _id: new ObjectId(colorId) }))?.songId).toBe(id);
    });

    it('returns 404 for an unknown id and 400 for a malformed one', async () => {
        const missing = await patch(new ObjectId().toHexString(), { label: 'x' });
        expect(missing.status).toBe(404);
        expect((await patch('nope', { label: 'x' })).status).toBe(400);
    });
});

describe('DELETE /api/colors/:id', () => {
    it('deletes only that entry with 204', async () => {
        const red = await seedColor('#ff0000');
        await seedColor('#00ff00');

        const res = await request(app).delete(`/api/colors/${red}`);

        expect(res.status).toBe(204);
        expect(res.body).toEqual({});
        const left = await request(app).get(`/api/songs/${id}/colors`);
        expect(left.body.map((c: { color: string }) => c.color)).toEqual(['#00ff00']);
    });

    it('returns 404 for an unknown id', async () => {
        await seedColor('#ff0000');
        const res = await request(app).delete(`/api/colors/${new ObjectId().toHexString()}`);

        expect(res.status).toBe(404);
        expect(await colors().countDocuments()).toBe(1);
    });

    it.each(['nope', 'abcdefghijkl', `${'a'.repeat(24)}0`])(
        'rejects the malformed id %s with 400',
        async (badId) => {
            const res = await request(app).delete(`/api/colors/${badId}`);
            expect(res.status).toBe(400);
        },
    );
});
