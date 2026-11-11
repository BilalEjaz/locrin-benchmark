import { test, expect } from './fixture';
import type { Page } from '@playwright/test';
import { Engine as Crates, LEVELS } from '../../src/engines/caisses/engine';
import { directions, pull } from '../../src/engines/caisses/rules';
const read = (page: Page) => page.evaluate(() => window.__CAISSES_TEST__?.read());
const gameState = (state: Awaited<ReturnType<typeof read>>) => {
    if (!state) throw new Error('État Caisses absent');
    const { character, ...game } = state;
    return { character, game };
};
/** Manual test clock: real time stops moving the scene, so two reads compare logic, never elapsed frames. */
const freeze = (page: Page) => page.evaluate(() => { window.__CAISSES_TEST__?.advance(0); });
async function activate(page: Page, selector: string, mobile: boolean) {
    if (mobile) await page.locator(selector).tap(); else await page.locator(selector).click();
}
const keys = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown' } as const;
/** Touch moves are swipes on the board: there is no arrow cross. */
async function swipe(page: Page, name: keyof typeof keys) {
    const box = await page.locator('#game canvas').boundingBox(); if (!box) throw new Error('Canevas absent');
    const [dx, dy] = ({ left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] } as const)[name];
    const x = box.x + box.width / 2, y = box.y + box.height / 2, cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * 40, y: y + dy * 40 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
}
async function direction(page: Page, name: keyof typeof keys, mobile: boolean) {
    if (mobile) await swipe(page, name); else await page.keyboard.press(keys[name]);
}
test('C-CAISSE la caisse de David remplace le dessin des caisses, rouge et rangée restent lisibles', async ({ page }, info) => {
    await page.goto('/?test=1#/caisses');
    await expect.poll(() => page.evaluate(() => Boolean(window.__CAISSES_TEST__))).toBe(true);
    const views = (level: number) => page.evaluate(level => { window.__CAISSES_TEST__?.loadLevel(level, 28); window.__CAISSES_TEST__?.advance(0); return window.__CAISSES_TEST__?.crateViews() ?? []; }, level);
    // The drawing arrives in its own chunk: every crate ends up drawn, a red one in red.
    await expect.poll(async () => (await views(25)).sort().join(' ')).toBe('red/drawn wood/drawn');
    await page.screenshot({ path: info.outputPath('caisses-caisse-rouge.png') });
    const home = await views(28);
    expect(home.every(v => v.endsWith('/drawn'))).toBe(true);
    expect(home.filter(v => v === 'home/drawn')).toHaveLength(2);
    expect(home).toHaveLength((await read(page))?.boxes.length ?? -1);
    await page.screenshot({ path: info.outputPath('caisses-caisse-rangee.png') });
});
test('C01 C04 C05 C06 C11 victoire, reprise, impasse sans défaite', async ({ page }, info) => {
    const mobile = info.project.name === 'mobile-chromium';
    await page.goto('/?test=1#/caisses');
    await expect.poll(() => page.evaluate(() => Boolean(window.__ARCADE_TEST__?.games.caisses))).toBe(true);
    await freeze(page);
    // Turn-based: no pause on desktop; on touch screens the ⏸ opens the pause page.
    if (mobile) await expect(page.locator('#pause')).toBeVisible(); else await expect(page.locator('#pause')).toBeHidden();
    await page.screenshot({ path: `test-results/screenshots/caisses-play-${info.project.name}.png` });
    // Complete the entire first level with real inputs; no scenario required.
    await direction(page,'right',mobile); await direction(page,'right',mobile);
    expect((await read(page))?.status).toBe('won'); expect((await read(page))?.score).toBe(1000);
    await expect(page.locator('#next-level')).toBeVisible();
    await page.screenshot({ path: `test-results/screenshots/caisses-won-${info.project.name}.png` });
    await activate(page,'#next-level',mobile); expect((await read(page))?.level).toBe(1);
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(window.__CAISSES_TEST__))).toBe(true);
    await freeze(page);
    if (mobile) await activate(page,'#pause',true);
    await activate(page,'#levels',mobile); await expect(page.locator('#level-list button').nth(1)).toBeEnabled();
    await activate(page,'#close-levels',mobile);
    await page.evaluate(() => { window.__CAISSES_TEST__?.scenario('corner'); });
    const before=await read(page); await direction(page,'left',mobile);
    expect((await read(page))?.deadlocked).toBe(true); expect((await read(page))?.status).toBe('playing');
    await expect(page.locator('#result')).toBeHidden();
    // The requested lost capture records a recoverable impasse: this game has no defeat.
    await page.screenshot({ path: `test-results/screenshots/caisses-lost-${info.project.name}.png` });
    if (mobile) await activate(page,'#caisses-undo',true); else await page.keyboard.press('Backspace');
    const after = gameState(await read(page));
    expect(after.game).toEqual(gameState(before).game);
    expect(after.character.id).toBe(gameState(before).character.id);
    expect(after.character.pose).toBe('profil');
    if (mobile) await activate(page,'#pause',true);
    await activate(page,'#restart',mobile); expect((await read(page))?.moves).toBe(0);
    await page.evaluate(() => { window.__CAISSES_TEST__?.loadLevel(29,28); });
    expect((await read(page))?.level).toBe(29);
    await page.screenshot({ path: `test-results/screenshots/caisses-level30-${info.project.name}.png` });
});
test('C01 C05 glisser tactile et menu bloquant les entrées', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-chromium', 'Parcours tactile');
    await page.goto('/?test=1#/caisses');
    await expect.poll(() => page.evaluate(() => Boolean(window.__CAISSES_TEST__))).toBe(true);
    await freeze(page);
    const box=await page.locator('#game canvas').boundingBox(); if (!box) throw new Error('Canevas absent');
    const cdp=await page.context().newCDPSession(page);
    const x=box.x+box.width*.3, y=box.y+box.height*.5;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+40,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await cdp.detach();
    expect((await read(page))?.moves).toBe(1);
    await activate(page,'#pause',true); const before=await read(page);
    // The pause page covers the controls (Reprendre sits at the bottom): a direct activation stays blocked.
    await page.locator('#caisses-undo').dispatchEvent('click', { detail: 0 }); expect(await read(page)).toEqual(before);
});
test('C20 commandes tactiles : Annuler permanent, Tirer seulement contre une caisse, aucune croix', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-chromium', 'Commandes tactiles');
    await page.goto('/?test=1#/caisses');
    await expect.poll(() => page.evaluate(() => Boolean(window.__CAISSES_TEST__))).toBe(true);
    await freeze(page);
    for (const name of ['left', 'up', 'down', 'right']) await expect(page.locator(`#caisses-${name}`)).toHaveCount(0);
    await expect(page.locator('#caisses-undo')).toBeVisible();
    // A level whose start has no crate in reach (the model decides, not the page).
    const quiet = LEVELS.findIndex((_, i) => { const m = new Crates(); m.loadLevel(i, 28); const s = m.state; return !directions.some(d => pull(m.board, { player: s.player, boxes: s.boxes, colors: s.colors, filled: s.filled }, d)); });
    expect(quiet).toBeGreaterThanOrEqual(0);
    await page.evaluate(index => { window.__CAISSES_TEST__?.loadLevel(index, 28); }, quiet);
    await expect(page.locator('#caisses-special')).toBeHidden(); await expect(page.locator('#caisses-undo')).toBeVisible();
    // Against a crate (box on the left, floor behind): Tirer shows and pulls it at once.
    await page.evaluate(() => { window.__CAISSES_TEST__?.scenario('corner'); });
    await expect(page.locator('#caisses-special')).toBeVisible();
    const before = await read(page); await page.locator('#caisses-special').tap();
    const after = await read(page);
    expect(after?.specialUses).toBe(0); expect(after?.player).toBe((before?.player ?? 0) + 1); expect(after?.boxes).toEqual([before?.player]);
    await expect(page.locator('#caisses-special')).toBeHidden(); await expect(page.locator('#caisses-undo')).toBeVisible();
});

test('C12 crochet absent sans paramètre test', async ({ page }) => {
    await page.goto('/#/caisses');
    await expect(page.locator('#game canvas')).toBeVisible();
    expect(await page.evaluate(() => window.__CAISSES_TEST__)).toBeUndefined();
    expect(await page.evaluate(() => window.__ARCADE_TEST__)).toBeUndefined();
});

// Pass 403: each introduction workshop names its mechanism; the first challenge fails at its budget and undo resumes.
test('C10 C19 ateliers d\'introduction annoncés, défi perdu au budget puis repris par annulation', async ({ page }, info) => {
    const mobile = info.project.name === 'mobile-chromium';
    await page.goto('/?test=1#/caisses');
    await expect.poll(() => page.evaluate(() => Boolean(window.__CAISSES_TEST__))).toBe(true);
    for (const [level, tip] of [[3, /Glace/], [7, /Flèches/], [11, /Bouton/], [15, /Trou/], [17, /Dalle fragile/], [20, /Plots/], [25, /Couleurs/], [29, /Grand final/]] as const) {
        await page.evaluate(index => { window.__CAISSES_TEST__?.loadLevel(index, 28); }, level);
        expect(await page.evaluate(() => window.__CAISSES_TEST__?.hudText() ?? '')).toMatch(tip);
        await page.screenshot({ path: `test-results/screenshots/caisses-intro-${String(level + 1)}-${info.project.name}.png` });
    }
    await page.evaluate(() => { window.__CAISSES_TEST__?.loadLevel(4, 28); });
    expect(await page.evaluate(() => window.__CAISSES_TEST__?.hudText() ?? '')).toMatch(/reste 13/);
    for (let i = 0; i < 13; i++) {
        await direction(page, i % 2 ? 'down' : 'up', mobile);
    }
    expect((await read(page))?.status).toBe('lost'); await expect(page.locator('#retry-level')).toBeVisible();
    await page.screenshot({ path: `test-results/screenshots/caisses-budget-${info.project.name}.png` });
    await page.keyboard.press('Backspace');
    expect((await read(page))?.status).toBe('playing');
});
test('C24 dalle fragile : traversée au vrai clavier ou au doigt, elle cède derrière le personnage', async ({ page }, info) => {
    const mobile = info.project.name === 'mobile-chromium';
    await page.goto('/?test=1#/caisses');
    await expect.poll(() => page.evaluate(() => Boolean(window.__CAISSES_TEST__))).toBe(true);
    await page.evaluate(() => { window.__CAISSES_TEST__?.loadLevel(17, 28); });
    await freeze(page);
    for (const d of ['up', 'up', 'right', 'right', 'right'] as const) await direction(page, d, mobile);
    expect((await read(page))?.broken).toEqual([]); // sur la dalle : elle tient
    await direction(page, 'right', mobile);
    const after = await read(page); expect(after?.player).toBe(25); expect(after?.broken).toEqual([24]); expect(after?.events).toEqual(['crack']);
    await direction(page, 'left', mobile); expect((await read(page))?.player).toBe(25); // le trou ne se traverse plus
    await page.screenshot({ path: `test-results/screenshots/caisses-dalle-${info.project.name}.png` });
});
