# PRD : KizunOrca, produit minimum pour le pitch Kizuna 2026

> Le moteur de calcul de KizunOrca a été acquis par ORCADEEP SARL (Les Berges du Lac, 1053 La Marsa, Tunis) après le succès de l'équipe Orca au hackathon : il est désormais propriétaire d'Orcadeep. Voir le [README](../README.md).

## Le problème
Dimensionner un réseau d'eau potable, c'est choisir un diamètre commercial pour chaque conduite. Le réseau doit respecter trois exigences qui se contredisent :
- la **vitesse** doit rester entre 0,3 et 1,2 m/s ;
- la **pression** doit rester d'au moins 20 m chez chaque abonné ;
- le **coût** doit être le plus bas possible.

Avec 14 diamètres et 3 133 conduites (le réseau de Kairouan), il existe 10^3591 réseaux possibles. Aujourd'hui, l'ingénieur en teste quelques dizaines à la main. Le résultat est souvent surdimensionné : de l'argent public gaspillé et de l'eau qui stagne.

## Notre angle
> **Le seul outil qui dimensionne un réseau entier au coût minimal en garantissant la vitesse et la pression au débit de pointe, en moins d'une minute, sur les vraies rues de la ville.**

| | EPANET | Module d'optimisation commercial (ex. Darwin Designer) | **KizunOrca** |
|---|---|---|---|
| Simulation hydraulique | Oui (référence) | Oui | Oui (même méthode, GGA) |
| Optimisation du coût sous contraintes | Non | Oui | **Oui, courbe de convergence en direct** |
| Réseau généré sur les rues réelles | Non | Non | **Oui (OpenStreetMap et altitudes)** |
| Conception depuis un texte (IA) | Non | Non | **Oui** |
| Hors ligne / sur site, sans envoyer les données | Oui | Selon licence | **Oui, avec cluster Docker optionnel** |
| Prix | Gratuit | Licence commerciale | Abonnement ou paiement à l'étude |

## Utilisateurs cibles
- **Ingénieur de bureau d'études** en Tunisie ou au Maghreb : il conçoit des extensions et des quartiers neufs, sous une forte pression sur les délais et les coûts.
- **Opérateur public**, par exemple la SONEDE ou les régies : il valide les projets et veut des preuves chiffrées.
- **Bailleur ou collectivité** : il veut payer le juste prix.

## Périmètre du produit minimum (ce qu'on montre en 6 minutes)
1. **Importer** un `.inp` EPANET, ou **décrire** le besoin en une phrase pour que l'agent IA construise le réseau sous les rues.
2. **Simuler** : pressions, vitesses, débits, et une note de santé sur 100.
3. **Régler les contraintes** : pression minimale, vitesse maximale, facteur de pointe.
4. **⚡ Optimiser** : moteur propriétaire Orcadeep, courbe du coût en direct, arrêt automatique à convergence.
5. **Rapport avant / après** au débit de pointe : coût en TND, conduites trop rapides, nœuds sous-pressurisés, eau lente, débit maximal.

## Indicateurs mesurés (moteur de calcul propriétaire Orcadeep)
| Cas | Coût avant | Coût après | Gain | Contraintes après |
|---|---|---|---|---|
| Tunis, Ville Nouvelle (75 conduites) | 1,78 M TND | 313 k TND | −82 % | 0 conduite > 1,2 m/s, P min 44 m |
| Tokyo, Okubo / Shinjuku (141 conduites) — *réseau généré, non exploité* | 6,10 M TND | 1,21 M TND | −80 % | 0 conduite > 1,2 m/s, P min 36 m |

**Réseaux de référence publiés (preuve vérifiable)** — fichiers WaterBenchmarkHub, règles officielles :

| Réseau | Record publié | KizunOrca | Écart |
|---|---|---|---|
| **Modène, Italie** — réseau réel de la ville (Bragalli et al. 2008), 317 conduites, P ≥ 20 m, V ≤ 2 m/s | 2,539 M€ (front Exeter) | 2,775 M€ | +9,3 % (1 départ, 6 min, mode FULL) |
| Two-Loop (Alperovits & Shamir 1977) | 419 000 $ | 419 000 $ | record égalé (2 s/départ) |
| Hanoi (Fujiwara & Khang 1990) | 6,081 M$ | 6,105 M$ | +0,40 % (meilleur de 24 départs, 10 s chacun) |

Aucun distributeur tunisien (SONEDE) ni japonais ne publie ses fichiers EPANET : Modène est le réseau de ville réel publié le plus proche. Balerma (irrigation, Espagne) est téléchargé mais pas encore résolu (aucune solution faisable : à corriger). Tunis et Tokyo sont des **réseaux de démonstration** générés sur les rues réelles (diamètres fictifs) : à présenter comme tels.

Ces gains sont mesurés sur des réseaux **volontairement surdimensionnés**. Sur un projet déjà bien conçu, le gain est plus faible ; c'est l'hypothèse « 5 % » du modèle économique.

## Hors périmètre du pitch
Chlore, pompage, capteurs de contamination et jumeau numérique de fuites. Ils relèvent du moteur de calcul propriétaire d'Orcadeep et constituent la feuille de route commerciale.

## Risques et réponses
| Risque | Réponse |
|---|---|
| « L'optimisation garantit-elle l'optimum ? » | Non, aucune méthode ne le garantit sur un réseau réel. Le moteur trouve une très bonne solution et le montre : la courbe se stabilise, et le calcul s'arrête après 3 relances de suite sans gain, plus une recherche locale. La graine fixe rend le résultat reproductible. |
| « Le calcul est-il juste ? » | Le solveur GGA est le même que celui d'EPANET, et le réseau optimisé est réexporté en `.inp`, contrôlable dans EPANET. |
| « Ça passe à l'échelle ? » | Le moteur de calcul, désormais propriété d'Orcadeep, est exploité par Orcadeep sur son infrastructure. |
| « Nos données sont sensibles. » | Tout tourne sur le poste ou sur un serveur interne. Seule l'intention textuelle part vers Claude, et le système fonctionne aussi sans clé. |
