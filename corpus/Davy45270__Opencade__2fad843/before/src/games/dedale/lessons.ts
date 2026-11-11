import { encounters, ENCOUNTERS, type Encounter } from '../../engines/dedale/labyrinth';
const LESSONS: Record<Encounter, string> = {
    key: 'Clé + porte dorées : ramasser puis ouvrir', key2: 'Deux couleurs : chaque porte a sa clé', arrow: 'Flèches : passage dans un seul sens',
    portal: 'Anneaux violets : portails aller-retour', switch: 'Bouton orange : ouvre / ferme les grilles', moving: 'Grille ▥ : deux temps fermée, deux ouverte',
    ice: 'Flocon bleu : glisse jusqu’à un obstacle', dark: 'Ombres : vision à 3 cases autour de vous',
};
export const WISP_LESSON = 'Follets : poursuite / patrouille / fuite';
/** HUD instruction: what this board really holds, its newest family; the four wisp roles on their own debut (level 25). */
export function lesson(level: number): string {
    if (level === 24) return WISP_LESSON;
    const newest = [...encounters(level)].sort((a, b) => ENCOUNTERS.indexOf(b) - ENCOUNTERS.indexOf(a))[0];
    return newest ? LESSONS[newest] : 'Quatre soleils et quatre graines à retrouver';
}
