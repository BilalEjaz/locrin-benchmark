import { Router } from 'express';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import type { ApiError, ColorEntry } from '@chromesthesia/shared';
import { colors, toColorEntry, type ColorDoc } from '../db.js';
import { partError, updateColorSchema } from '../validation.js';

const router = Router();

type IdParams = { id: string };

// ObjectId.isValid() also accepts any 12-character string, so check the hex form directly
const objectIdHex = /^[0-9a-f]{24}$/i;

// Change some fields of one color entry; null clears a field (owner-only once auth lands)
router.patch<IdParams, ColorEntry | ApiError>('/:id', async (req, res) => {
    if (!objectIdHex.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid color id' });
    }
    const parsed = updateColorSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: z.prettifyError(parsed.error) });
    }
    const _id = new ObjectId(req.params.id);
    const existing = await colors().findOne({ _id });
    if (!existing) return res.status(404).json({ error: 'Color not found' });

    const $set: Partial<ColorDoc> = {};
    const $unset: Partial<Record<keyof ColorDoc, ''>> = {};
    const merged: ColorDoc = { ...existing };
    for (const [key, value] of Object.entries(parsed.data) as [keyof ColorDoc, unknown][]) {
        if (value === null) {
            $unset[key] = '';
            delete merged[key];
        } else {
            Object.assign($set, { [key]: value });
            Object.assign(merged, { [key]: value });
        }
    }

    const message = partError(merged.startMs, merged.endMs);
    if (message) return res.status(400).json({ error: message });

    await colors().updateOne({ _id }, { $set, $unset });
    res.json(toColorEntry(merged));
});

// Remove one color entry (owner-only once auth lands)
router.delete<IdParams, ApiError>('/:id', async (req, res) => {
    if (!objectIdHex.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid color id' });
    }
    const result = await colors().deleteOne({ _id: new ObjectId(req.params.id) });
    if (!result.deletedCount) return res.status(404).json({ error: 'Color not found' });
    res.status(204).end();
});

export default router;
