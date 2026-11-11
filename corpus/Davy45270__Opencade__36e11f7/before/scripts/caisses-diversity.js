// Pass 403: workshop descriptors from the real parser (initial boards, no pilot).
import { measureDiversity } from './diversity-metrics.js';
export function caissesFeatures(board, data) {
    const elements = ['wall', 'box', 'target', 'push', 'undo', 'deadlock'], layout = [];
    const at = i => `${i % board.width},${Math.floor(i / board.width)}`;
    for (const k of ['walls', 'targets', 'boxes']) layout.push(...board[k].map(i => `${at(i)}:${k}`));
    const kinds = { ice: 'ice', plates: 'door', pits: 'pit', pads: 'teleporter' };
    for (const [k, name] of Object.entries(kinds)) if (board[k].length) { elements.push(name); layout.push(...board[k].map(i => `${at(i)}:${k}`)); }
    if (board.arrows.length) { elements.push('one-way'); layout.push(...board.arrows.map(a => `${at(a.at)}:${a.direction}`)); }
    if (board.boxColors.some(c => c)) elements.push('colours');
    if (data.budget) elements.push('move-budget');
    return { elements: elements.sort(), layout, params: { width: board.width, height: board.height, boxes: board.boxes.length, minimumSteps: data.minimumSteps, minimumPushes: data.minimumPushes, layoutCells: layout.length } };
}
export function caissesDiversity(mod, levels = mod.LEVELS.map((_, i) => i)) {
    return measureDiversity(levels.map((level, i) => {
        const data = mod.LEVELS[level], f = caissesFeatures(mod.parse(data.text), data);
        return { level: i + 1, parameters: f.params, elements: f.elements, layout: f.layout };
    }));
}
