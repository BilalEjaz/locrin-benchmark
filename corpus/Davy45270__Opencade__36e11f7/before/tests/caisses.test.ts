import { expect, test } from 'vitest';
import * as caisses from '../src/engines/caisses/engine';
import { Engine, LEVELS, parse, deadlocked, difficulty, type Direction } from '../src/engines/caisses/engine';
import { mechanical, usage } from '../src/engines/caisses/rules';
import { caissesDiversity } from '../scripts/caisses-diversity.js';
import campaign from './fixtures/caisses-campaign.json';
import { solutionMetrics } from '../src/engines/caisses/metrics';
import { solve } from '../src/engines/caisses/solver';
function fixture(text: string): Engine {
    const e = new Engine(); e.board = parse(text); e.restart(); return e;
}
const room = '#######\n#     #\n# @$ .#\n#     #\n#######';
test('C01 déplacement et murs', () => {
    const e = fixture(room); e.input('left'); expect(e.state.player).toBe(15);
    const before=e.snapshot(); e.input('left'); expect(e.snapshot()).toEqual(before);
    e.input('up'); expect(e.state.player).toBe(8);
});
test('C02 pousser une seule caisse, jamais deux ni contre un mur', () => {
    const e=fixture(room); e.input('right'); expect(e.state.boxes).toEqual([18]); expect(e.state.pushes).toBe(1);
    for (const text of ['#######\n#@$$..#\n#######', '#####\n#@$##\n# . #\n#####']) {
        const blocked=fixture(text), before=blocked.snapshot(); blocked.input('right'); expect(blocked.snapshot()).toEqual(before);
    }
});
test('C03 aucune traction', () => {
    const e=fixture(room); e.input('left'); expect(e.state.boxes).toEqual([17]); expect(e.state.pushes).toBe(0);
});
test('C04 toutes les caisses requises et gel après victoire', () => {
    const e=fixture('########\n#@$. $.#\n########'); e.input('right'); expect(e.status).toBe('playing');
    const win=fixture(room); win.input('right'); win.input('right'); expect(win.status).toBe('won');
    const before=win.snapshot(); win.input('left'); expect(win.snapshot()).toEqual(before);
});
test('C05 annuler exactement chaque état, y compris victoire, recommencer', () => {
    const e=fixture(room), initial=e.snapshot(); e.input('right'); const one=e.snapshot(); e.input('right');
    e.undo(); expect(e.snapshot()).toEqual(one); e.undo(); expect(e.snapshot()).toEqual(initial);
    e.undo(); expect(e.snapshot()).toEqual(initial); e.input('right'); e.restart(); expect(e.snapshot()).toEqual(initial);
});
test('C06 compteurs, score relatif au minimum de pas', () => {
    const e=new Engine(); e.input('right'); e.input('left'); e.input('right'); e.input('right');
    expect(e.state.moves).toBe(4); expect(e.state.pushes).toBe(1); expect(e.state.score).toBe(500);
});
test('C07 validation des dimensions, symboles, occupants et fermeture', () => {
    // Pass 403: pit rooms carry one extra box per pit.
    for (const level of LEVELS) { const b=parse(level.text); expect(b.boxes.length).toBe(b.targets.length + b.pits.length); }
    for (const text of ['###\n#@#\n###', '#####\n#@@$#\n# . #\n#####', '####\n#@$ .#\n####', '#####\n @$ .\n#####', '#####\n#@x.#\n#####']) expect(() => parse(text)).toThrow();
    expect(parse('#####\n#+* #\n# $ #\n#####').targets).toHaveLength(2);
});
// Pass 403: rooms with mechanisms are proved offline by the exact BFS (scripts/validate-caisses.js);
// Vitest replays the recorded proofs and re-solves only the historical rooms.
for (const [i, level] of LEVELS.entries()) test(`C08 C09 soluble et minimum exact : ${String(i+1)}`, () => {
    const proofs = campaign.caisses[i]; expect(proofs).toBeDefined(); if (!proofs) return;
    expect(proofs.pushes.pushes).toBe(level.minimumPushes); expect(proofs.steps.inputs.length).toBe(level.minimumSteps);
    const e = new Engine(); e.loadLevel(i);
    for (const d of proofs.steps.inputs) e.input(d as Direction);
    expect(e.status).toBe('won'); expect(e.state.moves).toBe(level.minimumSteps); expect(e.state.score).toBe(1000);
    if (!mechanical(e.board)) { const begin = performance.now(); expect(solve(e.board)?.pushes).toBe(level.minimumPushes); expect(performance.now() - begin).toBeLessThan(1000); }
});
test('C10 campagne : une mécanique neuve tous les 4 à 5 ateliers, défi à budget tous les 5', () => {
    const first = (has: (b: ReturnType<typeof parse>) => boolean) => LEVELS.findIndex(l => has(parse(l.text)));
    expect(first(b => b.ice.length > 0)).toBe(3); expect(first(b => b.arrows.length > 0)).toBe(7);
    expect(first(b => b.doors.length > 0)).toBe(11); expect(first(b => b.pits.length > 0)).toBe(15);
    expect(first(b => b.pads.length > 0)).toBe(20); expect(first(b => b.boxColors.some(c => c > 0))).toBe(25);
    expect(LEVELS.flatMap((l, i) => l.budget ? [i] : [])).toEqual([4, 9, 14, 19, 24]);
    const last = parse(LEVELS[29]?.text ?? '');
    expect([last.ice, last.arrows, last.doors, last.pits, last.pads].every(a => a.length > 0) && last.boxColors.includes(1)).toBe(true);
    expect(new Set(LEVELS.map(l => l.name)).size).toBe(30); expect(difficulty(4).budget).toBe(13);
});
test('C10 diversité mesurée : score <= 26, au plus un clone, et des ateliers identiques seraient détectés', () => {
    const r = caissesDiversity(caisses);
    expect(r.score).toBeLessThanOrEqual(26); expect(r.cloneShare).toBeLessThanOrEqual(0.05); expect(r.maxGapWithoutNovelty).toBeLessThanOrEqual(5);
    const clones = caissesDiversity(caisses, Array<number>(30).fill(6)); expect(clones.cloneShare).toBe(1);
});
test('C10b dès le quatrième atelier historique, tourner une caisse et contourner', () => {
    for (const level of LEVELS.slice(3).filter(l => !mechanical(parse(l.text)))) {
        const board = parse(level.text), solution = solve(board);
        expect(solution).not.toBeNull();
        const m = solutionMetrics(board, solution?.inputs ?? []);
        expect(m.turns).toBeGreaterThan(0); expect(m.detours).toBeGreaterThan(0);
        expect(board.width).toBeLessThanOrEqual(10); expect(board.height).toBeLessThanOrEqual(10);
    }
});
test('C11 coin hors cible seulement et récupération', () => {
    const e=fixture('######\n# $@ #\n# .  #\n######');
    expect(deadlocked(e.board,e.state.boxes)).toBe(false); const before=e.snapshot(); e.input('left');
    expect(e.snapshot().deadlocked).toBe(true); expect(e.status).toBe('playing'); e.undo(); expect(e.snapshot()).toEqual(before);
    expect(deadlocked(parse('#####\n#*@ #\n#####'),[6])).toBe(false);
    expect(solve(parse('######\n#$ @ #\n# .  #\n######'))).toBeNull();
});
test('C12 déterminisme, graine, pas fixe et snapshots indépendants', () => {
    const a=new Engine(), b=new Engine(); a.loadLevel(4,17); b.loadLevel(4,17);
    const inputs: Direction[]=['right','right','down','left','up'];
    for (const d of inputs) { a.input(d); b.input(d); a.step(1000/60); b.step(1000/120); b.step(1000/120); expect(a.snapshot()).toEqual(b.snapshot()); }
    expect(JSON.parse(JSON.stringify(a.snapshot()))).toEqual(a.snapshot()); const s=a.snapshot(); s.boxes.length=0; expect(a.state.boxes).toHaveLength(parse(LEVELS[4]?.text ?? "").boxes.length);
    for (const dt of [-1,NaN,Infinity]) expect(() => { a.step(dt); }).toThrow(RangeError);
});
const run = (text: string, inputs: string): Engine => { const e = fixture(text); for (const c of inputs) e.input(({ u: 'up', d: 'down', l: 'left', r: 'right' } as const)[c as 'u']); return e; };
test('C13 glace : la caisse glisse jusqu\'au premier obstacle, s\'arrête hors glace, tombe dans un trou', () => {
    const e = run('##########\n#@ $~~~~.#\n#        #\n##########', 'r'); expect(e.state.player).toBe(12); expect(e.state.boxes).toEqual([13]);
    e.input('right'); expect(e.state.boxes).toEqual([18]); expect(e.status).toBe('won'); expect(e.snapshot().events).toEqual(['slide']);
    expect(run('#########\n#@$~~$ .#\n#      .#\n#########', 'r').state.boxes).toEqual([13, 14]);
    const fall = run('#########\n#@$~~O .#\n#     $ #\n#########', 'r'); expect(fall.state.boxes).toEqual([24]); expect(fall.state.filled).toEqual([14]);
});
test('C14 sens unique : entrer seulement dans le sens de la flèche, pour le joueur et pour la caisse', () => {
    expect(run('#######\n#@ > .#\n#  $  #\n#######', 'rr').state.player).toBe(10);
    expect(run('#######\n#  >@ #\n#  $ .#\n#######', 'l').state.player).toBe(11);
    const box = run('#######\n#@$< .#\n#     #\n#######', 'r'); expect(box.state.boxes).toEqual([9]); expect(box.state.player).toBe(8);
});
test('C15 bouton et porte : ouverte tant qu\'une caisse ou le joueur presse le bouton', () => {
    expect(run('########\n#@o |  #\n#  $ . #\n########', 'rrr').state.player).toBe(11);
    expect(run('########\n#@o|   #\n#  $ . #\n########', 'rr').state.player).toBe(11);
    const held = run('########\n# $o| .#\n#@     #\n########', 'ur'); expect(held.state.boxes).toEqual([11]); expect(held.state.player).toBe(10);
    for (const d of ['down', 'right', 'right', 'up'] as const) held.input(d); expect(held.state.player).toBe(12);
});
test('C16 trou : infranchissable à pied, comblé par une caisse qui disparaît, puis praticable', () => {
    const e = run('########\n#@$O $.#\n#      #\n########', 'r'); expect(e.state.boxes).toEqual([13]); expect(e.state.filled).toEqual([11]); expect(e.snapshot().events).toEqual(['fall']);
    e.input('right'); expect(e.state.player).toBe(11); e.input('right'); e.input('right'); expect(e.status).toBe('won');
    expect(run('#######\n#@O $.#\n#######', 'r').state.player).toBe(8);
    expect(() => parse('#######\n#@ $..#\n#######')).toThrow();
});
test('C17 téléporteurs : arrivée sur un plot = sortie sur l\'autre s\'il est libre', () => {
    const e = run('#########\n#@1#  2 #\n####$ .##\n#########', 'r'); expect(e.state.player).toBe(15); expect(e.snapshot().events).toEqual(['teleport']);
    const blocked = fixture('#########\n#@1#  2 #\n####$ .##\n#########'); blocked.state.boxes = [15]; blocked.input('right'); expect(blocked.state.player).toBe(11);
});
test('C18 couleurs : une caisse rouge ne compte que sur une cible rouge', () => {
    expect(run('########\n#@r.  R#\n#   $  #\n########', 'r').status).toBe('playing');
    expect(run('########\n#@ r  R#\n#     *#\n########', 'rrrr').status).toBe('won');
});
test('C19 défi : atteindre le budget de pas termine la tentative, annuler la reprend', () => {
    const e = new Engine(); e.loadLevel(4); const budget = LEVELS[4]?.budget ?? 0;
    for (let i = 0; i < budget; i++) e.input(i % 2 ? 'down' : 'up');
    expect(e.status).toBe('lost'); expect(e.state.moves).toBe(budget); expect(e.budgetLeft()).toBe(0);
    e.undo(); expect(e.status).toBe('playing'); expect(e.budgetLeft()).toBe(1);
    const free = new Engine(); free.loadLevel(3); for (let i = 0; i < 40; i++) free.input(i % 2 ? 'left' : 'down'); expect(free.status).toBe('playing');
});
test('C20 analyseur : plots par paire unique, porte avec bouton, caisses suffisantes par couleur', () => {
    for (const text of ['#######\n#@2 $.#\n#######', '#######\n#@1 $.#\n#######', '########\n#@1$.12#\n########', '########\n#@2$.21#\n########', '#######\n#@$r..#\n#######', '#######\n#@| $.#\n#######', '#######\n#@r .R#\n#######']) expect(() => parse(text)).toThrow();
    expect(mechanical(parse('#######\n#@|o$.#\n#######'))).toBe(true);
});
test('C21 chaque mécanisme présent sert au témoin minimal en pas ; budgets exacts des cinq défis', () => {
    for (const [i, level] of LEVELS.entries()) {
        const b = parse(level.text), used = usage(b, campaign.caisses[i]?.steps.inputs ?? []);
        for (const [kind, cells] of [['ice', b.ice], ['arrow', b.arrows], ['door', b.doors], ['pit', b.pits], ['pad', b.pads]] as const) if (cells.length) expect(used.has(kind), `${String(i + 1)} ${kind}`).toBe(true);
        if (level.budget) expect(level.budget).toBe(level.minimumSteps + Math.max(4, Math.ceil(level.minimumSteps * 0.3)));
    }
    expect(LEVELS.filter(l => !mechanical(parse(l.text)))).toHaveLength(11);
});
test('C22 annuler après un trou comblé puis un pas restaure caisses, couleurs et trous ; instantanés indépendants', () => {
    const e = fixture('########\n#@$O $.#\n#      #\n########'), initial = e.snapshot();
    e.input('right'); e.input('right'); e.undo(); expect(e.state.filled).toEqual([11]); expect(e.state.player).toBe(10);
    e.undo(); expect(e.snapshot()).toEqual(initial);
    const s = e.snapshot(); s.colors.push(9); s.filled.push(9); expect(e.state.colors).toEqual([0, 0]); expect(e.state.filled).toEqual([]);
});
test('C23 oracle usage : glissade vers un trou comptée, rien d\'utilisé sans mécanisme franchi', () => {
    const b = parse('#########\n#@$~~O$.#\n#       #\n#########');
    expect([...usage(b, ['right'])].sort()).toEqual(['ice', 'pit']);
    expect([...usage(b, ['down', 'right'])]).toEqual([]);
    expect([...usage(parse('########\n#@o|  .#\n#  $   #\n########'), ['down'])]).toEqual([]);
});
