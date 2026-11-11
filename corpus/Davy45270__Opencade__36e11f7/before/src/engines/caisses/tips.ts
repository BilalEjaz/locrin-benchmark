import { LEVELS, parse } from './engine';
/** One short HUD hint per workshop: the newest mechanism first. */
export function workshopTip(level: number): string {
    const data = LEVELS[level]; if (!data) return '';
    const b = parse(data.text), earlier = LEVELS.slice(0, level).map(l => parse(l.text));
    const fresh = (has: (x: typeof b) => boolean) => has(b) && !earlier.some(has);
    if (fresh(x => x.ice.length > 0)) return 'Glace : la caisse glisse jusqu\'au bout';
    if (fresh(x => x.arrows.length > 0)) return 'Flèches : on n\'y entre que dans leur sens';
    if (fresh(x => x.doors.length > 0)) return 'Bouton : il ouvre la porte tant qu\'il est pressé';
    if (fresh(x => x.pits.length > 0)) return 'Trou : une caisse le comble';
    if (fresh(x => x.pads.length > 0)) return 'Plots : ils relient deux cases';
    if (fresh(x => x.boxColors.some(c => c > 0))) return 'Couleurs : rouge sur rouge, or sur or';
    if (data.budget) return `Défi : ${String(data.budget)} pas au plus`;
    return 'Poussez, ne tirez pas : un seul tirage';
}
