/** David's drawn props (barrier, crate, direction signs, tyre stacks), inlined in their own lazily loaded chunk, like the karts,
 *  the bonuses and the trees: precached for offline play, never downloaded by the catalogue before the game opens. */
const files = import.meta.glob<string>('./decor/*.webp', { eager: true, query: '?inline', import: 'default' });
export const sprites: Record<string, string> = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.slice(8, -5), url]));
/** His boost ramp, in the same chunk: the top view and its four quarters. */
const rampFiles = import.meta.glob<string>('./ramp/*.webp', { eager: true, query: '?inline', import: 'default' });
export const ramps: Record<string, string> = Object.fromEntries(Object.entries(rampFiles).map(([path, url]) => [path.slice(7, -5), url]));
/** The drawn props of the Paris cup (building, street lamp, advertising column), in the same chunk. */
const parisFiles = import.meta.glob<string>('./paris/*.webp', { eager: true, query: '?inline', import: 'default' });
export const paris: Record<string, string> = Object.fromEntries(Object.entries(parisFiles).map(([path, url]) => [path.slice(8, -5), url]));
