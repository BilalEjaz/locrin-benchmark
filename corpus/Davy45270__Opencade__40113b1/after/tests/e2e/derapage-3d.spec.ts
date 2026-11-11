import { test, expect, mobilePlay } from './fixture';
import type { Page } from '@playwright/test';
import type {} from '../../src/games/derapage/scene';
test.setTimeout(90_000);
async function open(page: Page): Promise<void> {
    await page.goto('/?test=1#/derapage');
    await page.waitForFunction(()=>Boolean(window.__DERAPAGE_TEST__));
    await page.locator('#resume').click();
}
async function toggle(page: Page): Promise<void> {
    const menu=page.locator('#pause');
    const mobile=await mobilePlay(page);
    if(mobile) await menu.click();
    const button=page.locator('#derapage-view');
    const box=await button.boundingBox(); expect(box).not.toBeNull();
    expect(box?.height).toBeGreaterThanOrEqual(44); expect(box?.width).toBeGreaterThanOrEqual(44);
    await button.click();
    if(mobile) await menu.click();
}
test('Y05 choix de vue persistant après rechargement',async({page})=>{
    await open(page); await toggle(page);
    await page.waitForFunction(()=>window.__DERAPAGE_TEST__?.view().active==='3d');
    await page.reload(); await page.waitForFunction(()=>Boolean(window.__DERAPAGE_TEST__));
    expect(await page.evaluate(()=>window.__DERAPAGE_TEST__?.view().preferred)).toBe('3d');
    await page.locator('#resume').click();
    await toggle(page);
    await page.waitForFunction(()=>window.__DERAPAGE_TEST__?.view().active==='top');
    await page.reload(); await page.waitForFunction(()=>Boolean(window.__DERAPAGE_TEST__));
    expect(await page.evaluate(()=>window.__DERAPAGE_TEST__?.view().preferred)).toBe('top');
});
test('Y06 cadence mobile bridée ou repli automatique',async({page},info)=>{
    test.skip(info.project.name!=='mobile-chromium');
    await open(page);
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    try {
        await toggle(page);
        const measured=await page.evaluate(()=>new Promise<{fps:number;elapsed:number}>(resolve=>{
            const stamps:number[]=[];
            const sample=(time:number):void=>{
                stamps.push(time);
                const start=stamps[0] ?? time;
                if(time-start<5000) {requestAnimationFrame(sample);return;}
                const recent=stamps.filter(t=>t>=time-2000);
                resolve({fps:(recent.length-1)*1000/(time-(recent[0] ?? time)),elapsed:time-start});
            };
            requestAnimationFrame(sample);
        }));
        await page.waitForFunction(()=>{
            const view=window.__DERAPAGE_TEST__?.view();
            return view && (view.fallback || view.elapsed>=5000);
        },undefined,{timeout:60_000});
        const view=await page.evaluate(()=>window.__DERAPAGE_TEST__?.view());
        expect(view).toBeDefined();
        expect(measured.fps>=30 || (view?.fallback && view.active==='top')).toBe(true);
        expect(view?.preferred).toBe('3d');
        await info.attach('cadence-3d',{body:JSON.stringify({view,presentations:measured},null,2),contentType:'application/json'});
    } finally { await cdp.send('Emulation.setCPUThrottlingRate',{rate:1}); await cdp.detach(); }
});
test('Y07 arrivée pilotée et panneau commun aux deux vues',async({page})=>{
    await page.addInitScript(()=>{ localStorage.setItem('arcade-lab:derapage:controls:v1',JSON.stringify({camera:'fixed',assist:true})); });
    await open(page);
    const results=[];
    for(const view of ['top','3d']) {
        await page.evaluate(()=>window.__DERAPAGE_TEST__?.scenario('finish'));
        if(view==='3d') await toggle(page);
        const box=await page.locator('#game canvas').boundingBox();
        if(!box) throw new Error('Canevas absent');
        const cdp=await page.context().newCDPSession(page);
        const x=box.x+box.width*.5,y=box.y+box.height*.75,radius=box.width/360*50;
        const initial=await page.evaluate(()=>window.__DERAPAGE_TEST__?.read().karts[0]?.angle);
        if(initial===undefined) throw new Error('Pilote absent');
        const worldHeading=initial+1.45;
        try {
            await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
            for(let frame=0;frame<180;frame++) {
                const state=await page.evaluate(()=>window.__DERAPAGE_TEST__?.read());
                if(!state || state.status!=='playing') break;
                const angle=state.karts[0]?.angle ?? initial;
                const heading=view==='3d' ? worldHeading-angle-Math.PI/2 : worldHeading;
                await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+Math.cos(heading)*radius,y:y+Math.sin(heading)*radius,id:1}]});
                await page.evaluate(()=>window.__DERAPAGE_TEST__?.advance(1000/60));
            }
        } finally {
            await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
            await cdp.detach();
        }
        await page.waitForFunction(()=>window.__DERAPAGE_TEST__?.read().status!=='playing');
        await expect(page.locator('#result-title')).toBeVisible();
        await expect(page.locator('#result-scores')).toContainText('Temps total');
        await expect(page.locator('#result-scores')).toContainText('Meilleur tour');
        await expect(page.locator('#result-scores')).toContainText('Record du circuit');
        await expect(page.locator('#result-scores')).toContainText('Classement');
        await expect(page.locator('#next-level')).toBeVisible();
        await expect(page.locator('#replay-level')).toBeVisible();
        results.push({title:await page.locator('#result-title').textContent(),scores:await page.locator('#result-scores').innerText()});
    }
    // The first finish sets the circuit record, the second only equals it: the badge is the one difference.
    expect(results[0]?.scores).toContain('Nouveau record !');
    expect(results[1]?.scores).not.toContain('Nouveau record !');
    const panel=(r: { title: string | null; scores: string } | undefined) => r && { ...r, scores: r.scores.replace(/\n?Nouveau record !/, '') };
    expect(panel(results[1])).toEqual(panel(results[0]));
});
test('Y08 captures perspective et HUD réservé',async({page},info)=>{
    await open(page);
    await page.evaluate(()=>window.__DERAPAGE_TEST__?.advance(0));
    await toggle(page);
    for(const [level,name] of [[0,'derapage-3d-play'],[29,'derapage-3d-level30']] as const) {
        await page.evaluate(level=>{window.__DERAPAGE_TEST__?.loadLevel(level,28);window.__DERAPAGE_TEST__?.advance(0);},level);
        await page.waitForFunction(()=>window.__DERAPAGE_TEST__?.view().active==='3d');
        const bounds=await page.evaluate(()=>window.__DERAPAGE_TEST__?.bounds());
        expect(bounds).toBeDefined();
        expect((bounds?.hud.y ?? 0)+(bounds?.hud.height ?? 0)).toBeLessThanOrEqual(96);
        await expect(page.locator('[data-derapage-hud]')).toContainText('MEILLEUR');
        await page.screenshot({path:`test-results/screenshots/${name}-${info.project.name}.png`});
    }
});
test('commandes 3D mobiles : pouce vers le haut conserve le cap',async({page},info)=>{
    test.skip(info.project.name!=='mobile-chromium');
    await open(page);
    await page.evaluate(()=>window.__DERAPAGE_TEST__?.advance(0));
    await toggle(page);
    const box=await page.locator('#game canvas').boundingBox(); if(!box) throw new Error('Canevas absent');
    const cdp=await page.context().newCDPSession(page);
    const x=box.x+box.width*.75,y=box.y+box.height*.65;
    const angle=await page.evaluate(()=>window.__DERAPAGE_TEST__?.read().karts[0]?.angle);
    expect(angle).toBeDefined();
    try {
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
        for(const [dx,dy,offset] of [[0,-40,0],[40,0,Math.PI/2],[4,0,null]] as const) {
            await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx,y:y+dy,id:1}]});
            await page.evaluate(()=>window.__DERAPAGE_TEST__?.advance(0));
            const controls=await page.evaluate(()=>window.__DERAPAGE_TEST__?.read().controls);
            expect(controls?.mode).toBe('joystick');
            if(offset===null) expect(controls?.heading).toBeUndefined();
            else expect(controls?.heading).toBeCloseTo((angle ?? 0)+offset,10);
        }
    } finally { await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await cdp.detach(); }
});
test('Z42 en poursuite 3D, le kart du joueur montre ses vues ¾ arrière en virage, du côté du virage',async({page},info)=>{
    test.skip(info.project.name!=='desktop-chromium');
    await open(page);
    await page.evaluate(()=>window.__DERAPAGE_TEST__?.advance(0));
    await toggle(page);
    await page.waitForFunction(()=>window.__DERAPAGE_TEST__?.view().active==='3d');
    // The drawn karts arrive in their own chunk: wait until the player's kart is a drawing.
    await page.waitForFunction(()=>{ const s=window.__DERAPAGE_TEST__?.read(); return Boolean(s?.kartViews.some(key=>key.startsWith(`${String(s.drivers[0])}_`))); });
    // Frames stepped one by one in the page; the player's drawn view is read after each one.
    const drive=async(frames:number): Promise<string[]>=>page.evaluate(frames=>{
        const h=window.__DERAPAGE_TEST__, views: string[]=[];
        for(let frame=0;frame<frames;frame++) { h?.advance(1000/60); const s=h?.read(); views.push(s?.kartViews.find(key=>key.startsWith(`${String(s.drivers[0])}_`))?.split('_')[1] ?? '?'); }
        return views;
    },frames);
    // Out of the starting pack, at racing speed: straight ahead for 2.5 s.
    await page.keyboard.down('ArrowUp'); await drive(150); await page.keyboard.up('ArrowUp');
    const seen: Record<string,string[]>={};
    for(const [key,expected] of [['ArrowRight','backRight'],['ArrowUp','back'],['ArrowLeft','backLeft'],['ArrowUp','back']] as const) {
        await page.keyboard.down(key);
        const views=await drive(30);
        await page.keyboard.up(key);
        seen[`${String(Object.keys(seen).length)} ${key}:${expected}`]=views;
        // Settled within a fifth of a second, then held without flicker for the rest of the turn.
        expect(views.slice(12),`${key} : ${views.join(' ')}`).toEqual(Array(18).fill(expected));
        if(expected!=='back') await page.screenshot({path:`test-results/screenshots/derapage-3d-virage-${expected}.png`});
    }
    await info.attach('vues-en-virage',{body:JSON.stringify(seen,null,1),contentType:'application/json'});
});
