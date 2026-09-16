<?php

declare(strict_types=1);

/**
 * @author  MEMORA solutions <info@memora.ca> (https://memora.solutions)
 * @project laveille.ai
 *
 * Historique complet des versions et règles de bump SemVer : docs/HISTORIQUE-VERSIONS.md
 * (ce fichier ne contient plus que le code — allégé le 2026-08-28, 954 948 -> quelques centaines
 * d'octets, pour arrêter de saturer la mémoire à chaque rechargement de configuration en test).
 */

$lvMajor = 1;
$lvMinor = 256;
$lvPatch = 0;

return [
    'major' => $lvMajor,
    'minor' => $lvMinor,
    'patch' => $lvPatch,

    // Codename optionnel (nom de la release courante). Vide ou null si pas de codename.
    'codename' => 'quatrieme-porte',

    // Format du SemVer assemblé — DÉRIVÉ automatiquement de major.minor.patch (source unique).
    // NE JAMAIS figer cette valeur en dur (incident déjà survenu — voir archive, #319).
    'semver' => $lvMajor.'.'.$lvMinor.'.'.$lvPatch,
];
