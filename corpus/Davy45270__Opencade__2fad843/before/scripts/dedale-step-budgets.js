// Deterministic step budgets for the Dédale fast checks (measured × 1.5, rounded up; pass 503).
// Engine steps do not depend on machine load: these replace the former 2 s wall-clock oracles.
export const STEP_BUDGETS = {
    "replay": 6320,
    "D-ROUTE toutes les paires au seuil littéral de 30 %": 3140,
    "D-CURVE moyennes croissantes et rapport 1,5": 10,
    "D-FINAL témoins recalculés et nouveautés par mécanique": 3140,
    "D-SOLVER recherche réelle rapide incluant le final": 20,
    "D-GEOMETRY anneau spirale miroir": 10,
    "D-MEC-01 clés et portes colorées": 10,
    "D-MEC-02 sens unique": 10,
    "D-MEC-03 portails appariés": 10,
    "D-MEC-04 interrupteur ouvre et ferme": 10,
    "D-MEC-05 murs au cycle régulier": 10,
    "D-MEC-06 glace jusqu’au prochain obstacle": 10,
    "D-SLIDE-CONTACT contact intermédiaire actif et vulnérable": 10,
    "D-DEATH inventaire et interrupteur persistent": 10,
    "D-CLOCK niveaux et durées exactes": 10,
    "D-MEC-07 obscurité limite la vision": 10,
    "D-MEC-08 follets poursuivent patrouillent et fuient la lumière": 10,
    "total": 6290
};
