/* global console, performance */
// node --import ./scripts/ts-loader.js scripts/validate-caisses.js
// Pass 403: clock-free bounds (visited positions), exact records, mechanisms that matter.
import assert from 'node:assert/strict';
import { Engine, LEVELS, parse } from '../src/engines/caisses/engine.ts';
import { solve } from '../src/engines/caisses/solver.ts';
import { mechanical, usage } from '../src/engines/caisses/rules.ts';
import { solutionMetrics } from '../src/engines/caisses/metrics.ts';
import { pullRecords } from '../src/engines/caisses/records.ts';
// Pits are left in place (removing them would only unbalance boxes and targets); their use is checked below.
const neutral = text => text.replace(/[~<>^v12]/g, ' ').replace(/[o|]/g, ' ').replace(/r/g, '$').replace(/R/g, '.');
console.log('| Niveau | Caisses | Pas min. | Poussées min. | visited | Sans mécanisme | Durée ms¹ |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const [i, level] of LEVELS.entries()) {
    const board = parse(level.text), start = performance.now();
    const solution = solve(board), steps = solve(board, 'steps');
    const duration = performance.now() - start;
    assert(solution && steps, `C08 niveau ${i + 1}`);
    assert.equal(solution.pushes, level.minimumPushes, `C09 poussées ${i + 1}`);
    assert.equal(steps.inputs.length, level.minimumSteps, `C09 pas ${i + 1}`);
    assert(solution.visited <= 300000 && steps.visited <= 300000, `Budget ${i + 1}: ${solution.visited}/${steps.visited} positions`);
    // The exact BFS of mechanism rooms settles at least one position per input of its witness.
    if (mechanical(board)) assert(steps.visited >= steps.inputs.length && solution.visited >= solution.pushes, `C08 positions visitées ${i + 1}`);
    assert(board.width <= 10 && board.height <= 10);
    for (const witness of [solution, steps]) {
        const e = new Engine(); e.loadLevel(i);
        for (const d of witness.inputs) e.input(d);
        // Challenge rooms: a witness longer than the move budget ends the attempt.
        assert.equal(e.status, level.budget && witness.inputs.length > level.budget ? 'lost' : 'won', `C08 rejeu ${i + 1}`);
    }
    let without = '—';
    if (mechanical(board)) {
        // The room's mechanisms change the puzzle: neutralised, it is invalid, unsolvable or 4+ steps away.
        let other = null, invalid = false;
        try { other = solve(parse(neutral(level.text)), 'steps'); } catch { invalid = true; }
        without = invalid ? 'invalide' : other ? String(other.inputs.length) : 'insoluble';
        if (!board.pits.length) assert(invalid || !other || Math.abs(other.inputs.length - steps.inputs.length) >= 4, `C13 mécanisme décoratif ${i + 1}`);
        // Every mechanism present is used by the fewest-steps witness (colours excepted: they constrain the goal).
        const used = usage(board, steps.inputs), present = { ice: board.ice, arrow: board.arrows, door: board.doors, pit: board.pits, pad: board.pads };
        for (const [kind, cells] of Object.entries(present)) assert(!cells.length || used.has(kind), `C13 ${kind} inutilisé ${i + 1}`);
    } else if (i >= 3) {
        const m = solutionMetrics(board, solution.inputs);
        assert(m.turns > 0 && m.detours > 0, `C10b ${i + 1}`);
    }
    if (level.budget) {
        assert.equal(level.budget, level.minimumSteps + Math.max(4, Math.ceil(level.minimumSteps * 0.3)), `C14 budget ${i + 1}`);
        const e = new Engine(); e.loadLevel(i); for (const d of steps.inputs) e.input(d); assert.equal(e.status, 'won');
    }
    console.log(`| ${i + 1} | ${board.boxes.length} | ${steps.inputs.length} | ${solution.pushes} | ${solution.visited} | ${without} | ${duration.toFixed(1)} |`);
}
console.log('\n¹ Informatif : aucune assertion ne dépend du temps.');
console.log('\n| Niveau | Poussées avec tirage | Pas avec tirage |');
console.log('| --- | --- | --- |');
for (const [i, level] of LEVELS.entries()) {
    const board = parse(level.text), pushes = solve(board, 'pushes', true), steps = solve(board, 'steps', true);
    assert(pushes && steps);
    assert.equal(pushes.pushes, pullRecords[i].pushes); assert.equal(steps.inputs.length, pullRecords[i].steps);
    for (const proof of [pushes, steps]) {
        const e = new Engine(); e.loadLevel(i);
        for (const action of proof.inputs) {
            if (action.startsWith('pull-')) assert(e.special(action.slice(5)));
            else e.input(action);
        }
        const over = level.budget && proof.inputs.length > level.budget;
        assert.equal(e.status, over ? 'lost' : 'won'); if (!over) assert.equal(e.state.pushes, proof.pushes);
    }
    console.log(`| ${i + 1} | ${pushes.pushes} | ${steps.inputs.length} |`);
}
