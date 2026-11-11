import { describe, expect, it } from 'vitest';
import { safeNext } from './next';

describe('safeNext', () => {
    it('keeps paths on this site, with their query', () => {
        expect(safeNext('/studio?code=abc')).toBe('/studio?code=abc');
        expect(safeNext('/songs/123')).toBe('/songs/123');
    });

    it('falls back to the Studio for anything else', () => {
        for (const next of [
            null,
            '',
            'https://evil.example',
            '//evil.example',
            '/\\evil.example',
        ]) {
            expect(safeNext(next)).toBe('/studio');
        }
    });
});
