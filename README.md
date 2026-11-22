# KizunOrca

Jumeau numérique et optimisation des réseaux d'eau potable et d'irrigation, conçus directement sur l'image satellite (hackathon Kizuna 2026).

> ## 🏆 Moteur de calcul acquis par Orcadeep
>
> Après le succès majeur de l'équipe **Orca** au hackathon Kizuna 2026, l'entreprise **ORCADEEP SARL**,
> située Immeuble du Lac de Constance, bloc A, 2e étage, n° 2.2, Les Berges du Lac, 1053 La Marsa, Tunis (Tunisie),
> a acquis le moteur de calcul de KizunOrca pour le commercialiser.
>
> Ce moteur de calcul (solveur hydraulique, optimisation du dimensionnement,
> du pompage, du chlore et des capteurs) est désormais **la propriété exclusive d'Orcadeep**. Il a été retiré de ce dépôt
> et de tout son historique, et n'est plus distribué publiquement.
>
> Contact : contact@orcadeep.com

## Ce que contient ce dépôt
L'interface de bureau (Electron + React + Leaflet), la génération de réseaux sur les rues OpenStreetMap,
l'agent IA (intention → réseau) et les résultats publiés des cas de démonstration et des réseaux de référence.
Le bouton **⚡ Optimiser** affiche « moteur propriétaire » : l'optimisation n'est disponible qu'auprès d'Orcadeep.
La construction de l'application nécessite un accès aux bibliothèques de calcul d'Orcadeep, qui ne sont pas publiques.

```bash
npm install
cp .env.example .env      # puis y mettre ANTHROPIC_API_KEY
npm run dev               # ouvre la fenêtre de bureau
npm run dist              # .exe portable Windows (electron-builder)
```

- **▶ Simuler** : calcul hydraulique ; les couleurs de pression et de débit restent ensuite à jour à chaque modification.
- **Projets** : chaque projet est enregistré automatiquement dans l'application ; l'onglet Projets permet de passer de l'un à l'autre.

## Scripts
| Commande | Rôle |
|---|---|
| `npx tsx --tsconfig tsconfig.json scripts/make-case.ts tokyo` | génère un cas réel sur les rues OSM (`cases/tokyo-shinjuku.inp`) |
| `npx tsx --tsconfig tsconfig.json scripts/agent-test.ts "…"` | agent IA de bout en bout (intention → rues → simulation) |
| `python -I scripts/build-deck.py` puis `build-pptx.py <captures>` | régénère `../KizunOrca-pitch.html` / `.pptx` |

## Résultats publiés sur les réseaux de référence
Obtenus avec le moteur de calcul, désormais propriétaire d'Orcadeep. Les réseaux optimisés sont fournis
(`cases/benchmarks/*-optimise.inp`) et restent vérifiables dans EPANET.

| Réseau | Origine | Fichier | Record publié |
|---|---|---|---|
| Hanoi (34 conduites) | Fujiwara & Khang 1990, *Water Resources Research* 26(4), doi:10.1029/WR026i004p00539 — réseau maître planifié de Hanoi | WaterBenchmarkHub `network-hanoi/HAN.inp` + `han-design_problem.csv` | 6,081 M$ |
| **Modène (317 conduites)** | Réseau réel de la ville de Modène, Italie — Bragalli et al. 2008 (IBM RC24495), fiche https://uknowledge.uky.edu/wdst_international/5 ; P ≥ 20 m, V ≤ 2 m/s | WaterBenchmarkHub `network-modena/MOD.inp` + `MOD_Cost.csv` (+ `MOD_Pressure.csv`) | 2,539 M€ (front de Pareto Univ. Exeter, `exeter-bestPF_MOD.txt`) — KizunOrca 2,775 M€ (+9,3 %) |
| Two-Loop (8 conduites) | Alperovits & Shamir 1977, *WRR* 13(6), doi:10.1029/WR013i006p00885 — réseau d'école | WaterBenchmarkHub `network-tln/TLN.inp` + `tln-design_problem.csv` | 419 000 $ |

Fichiers téléchargés sans modification depuis https://github.com/WaterFutures/WaterBenchmarkHub ; records : Kambalame et al. 2025,
*World Water Policy*, doi:10.1002/wwp2.12238. Règles officielles : barème du CSV, pression ≥ 30 m, Hazen-Williams C = 130, pas de limite de vitesse.

⚠️ Les réseaux de **Tunis** (`src/demo.inp`) et **Tokyo** (`cases/tokyo-shinjuku.inp`) ne sont **pas** des réseaux exploités :
ils sont générés sur les rues réelles OpenStreetMap avec des diamètres de départ volontairement surdimensionnés (démonstration).

Produit : [docs/PRD.md](docs/PRD.md) · analyse : [docs/ANALYSE.md](docs/ANALYSE.md).

© Moteur de calcul : ORCADEEP SARL, tous droits réservés.
