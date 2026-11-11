import { liveries } from '../../characters/arcade-art';
import type { CharacterId } from '../../characters/model';
/** What the end-of-race panel shows: times already formatted, the order of the karts (ids, 0 = the player) and
 *  the mascot driving each kart. */
export interface RaceResult {
    total: string;
    bestLap: string;
    record: string;
    newRecord: boolean;
    order: readonly number[];
    drivers: readonly (CharacterId | undefined)[];
}
/** The three result lines (label, value) then the ranking, one line per kart: the player's kart is marked. */
export function resultLines(r: RaceResult): { stats: [string, string][]; ranking: { place: number; name: string; you: boolean; colour: string }[] } {
    return {
        stats: [['Temps total', r.total], ['Meilleur tour', r.bestLap], ['Record du circuit', r.record]],
        ranking: r.order.map((id, i) => {
            const driver = r.drivers[id], livery = driver ? liveries[driver] : undefined;
            return { place: i + 1, name: livery?.name ?? `Kart ${String(id + 1)}`, you: id === 0, colour: livery?.body ?? '#8899aa' };
        }),
    };
}
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
};
/** Fills the result paragraph: a row of three tiles, then the ranking as a list (phrasing elements, the host is a `p`). */
export function renderResult(host: HTMLElement, r: RaceResult): void {
    const { stats, ranking } = resultLines(r);
    const tiles = make('span', 'pistouille-stats');
    for (const [label, value] of stats) {
        const tile = make('span', 'pistouille-stat');
        tile.append(make('span', 'pistouille-label', label), make('strong', 'pistouille-value', value));
        if (label === 'Record du circuit' && r.newRecord) tile.append(make('span', 'pistouille-new', 'Nouveau record !'));
        tiles.append(tile);
    }
    const list = make('span', 'pistouille-ranking');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Classement');
    for (const line of ranking) {
        const item = make('span', `pistouille-rank${line.you ? ' you' : ''}`);
        item.setAttribute('role', 'listitem');
        const dot = make('span', 'pistouille-dot');
        dot.style.background = line.colour;
        item.append(make('span', 'pistouille-place', `${String(line.place)}.`), dot, make('span', 'pistouille-name', line.name));
        if (line.you) item.append(make('span', 'pistouille-you', 'toi'));
        list.append(item);
    }
    host.replaceChildren(tiles, make('span', 'pistouille-heading', 'Classement'), list);
}
/** Podium of the three first karts, drawn with the karts of the race (`kart` gives the drawn front view of a
 *  mascot, or nothing until its chunk is loaded: the step stays, with the kart's colour). Canvas 400 × 260. */
export function drawPodium(context: CanvasRenderingContext2D, r: RaceResult, kart: (id: CharacterId) => CanvasImageSource | undefined): void {
    const W = 400, H = 260, ink = '#2c2638';
    context.clearRect(0, 0, W, H);
    // A framed card: evening sky, then the sun burst behind the winner, all inside the rounded frame.
    context.save();
    context.beginPath(); context.roundRect(2, 2, W - 4, H - 4, 22); context.clip();
    const sky = context.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#2f6f9f'); sky.addColorStop(1, '#173a5a');
    context.fillStyle = sky; context.fillRect(0, 0, W, H);
    const glow = context.createRadialGradient(200, 120, 10, 200, 120, 200);
    glow.addColorStop(0, '#ffe9a0'); glow.addColorStop(.45, '#f7b84a55'); glow.addColorStop(1, '#f7b84a00');
    context.fillStyle = glow; context.fillRect(0, 0, W, H);
    context.fillStyle = '#fff4c533';
    for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6, b = a + Math.PI / 14;
        context.beginPath(); context.moveTo(200, 120);
        context.lineTo(200 + Math.cos(a) * 260, 120 + Math.sin(a) * 260); context.lineTo(200 + Math.cos(b) * 260, 120 + Math.sin(b) * 260);
        context.closePath(); context.fill();
    }
    // Checkered bunting across the top.
    for (let i = 0; i < 10; i++) {
        const x = 20 + i * 36, y = 14 + Math.sin(i / 9 * Math.PI) * 10;
        context.fillStyle = i % 2 ? '#ffffff' : '#20202a';
        context.beginPath(); context.moveTo(x, y); context.lineTo(x + 36, y + (i < 4.5 ? 3 : -3)); context.lineTo(x + 18, y + 26); context.closePath(); context.fill();
        context.strokeStyle = ink; context.lineWidth = 2; context.stroke();
    }
    // Confetti in a fixed pattern.
    const confetti = ['#ff579c', '#ffcd45', '#63cfff', '#70df85', '#ab80ff'];
    for (let i = 0; i < 26; i++) {
        const x = (i * 97 + 31) % 380 + 10, y = (i * 53 + 17) % 150 + 40;
        context.save(); context.translate(x, y); context.rotate(i * .7);
        context.fillStyle = confetti[i % confetti.length] ?? '#ffcd45'; context.fillRect(-4, -2, 8, 4);
        context.restore();
    }
    // Steps: 2nd on the left, 1st in the middle, 3rd on the right.
    const steps = [{ rank: 1, x: 140, h: 78, face: '#f2c13d', top: '#ffe07a' }, { rank: 0, x: 20, h: 54, face: '#b9c3cf', top: '#e3e9f0' }, { rank: 2, x: 260, h: 38, face: '#d08a52', top: '#f0b07e' }];
    for (const step of steps) {
        const id = r.order[step.rank === 1 ? 0 : step.rank === 0 ? 1 : 2];
        if (id === undefined) continue;
        const y = H - step.h, driver = r.drivers[id];
        context.fillStyle = step.face; context.strokeStyle = ink; context.lineWidth = 4;
        context.beginPath(); context.roundRect(step.x, y, 120, step.h + 6, 8); context.fill(); context.stroke();
        context.fillStyle = step.top; context.fillRect(step.x + 3, y + 3, 114, 9);
        const place = step.rank === 1 ? '1' : step.rank === 0 ? '2' : '3';
        context.font = '700 30px system-ui, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
        context.lineWidth = 6; context.strokeText(place, step.x + 60, y + Math.min(step.h / 2 + 6, 40));
        context.fillStyle = '#ffffff'; context.fillText(place, step.x + 60, y + Math.min(step.h / 2 + 6, 40));
        // The kart on its step, the winner larger.
        const height = step.rank === 1 ? 110 : 88, image = driver ? kart(driver) : undefined;
        if (image) {
            const w = image instanceof HTMLImageElement ? image.naturalWidth : 76, h = image instanceof HTMLImageElement ? image.naturalHeight : 84;
            const width = height * w / h;
            context.imageSmoothingQuality = 'high';
            context.drawImage(image, step.x + 60 - width / 2, y - height + 4, width, height);
        } else {
            context.fillStyle = driver ? liveries[driver].body : '#8899aa';
            context.beginPath(); context.ellipse(step.x + 60, y - 22, 40, 20, 0, 0, Math.PI * 2); context.fill(); context.stroke();
        }
        if (id === 0) {
            // A tag over the player's kart.
            const tagY = y - height - 6;
            context.fillStyle = '#64e4cc'; context.strokeStyle = ink; context.lineWidth = 3;
            context.beginPath(); context.roundRect(step.x + 36, tagY - 22, 48, 22, 8); context.fill(); context.stroke();
            context.beginPath(); context.moveTo(step.x + 54, tagY); context.lineTo(step.x + 60, tagY + 7); context.lineTo(step.x + 66, tagY); context.fill();
            context.fillStyle = '#10202a'; context.font = '700 15px system-ui, sans-serif'; context.fillText('TOI', step.x + 60, tagY - 10);
        }
    }
    context.restore();
    context.strokeStyle = '#64e4cc'; context.lineWidth = 3;
    context.beginPath(); context.roundRect(2, 2, W - 4, H - 4, 22); context.stroke();
}
