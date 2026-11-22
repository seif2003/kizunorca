# Analyse : ce que KizunOrca apporte

> **Moteur de calcul propriétaire.** Après le succès majeur de l'équipe Orca au hackathon Kizuna 2026,
> ORCADEEP SARL (Immeuble du Lac de Constance, bloc A, 2e étage, n° 2.2, Les Berges du Lac, 1053 La Marsa, Tunis)
> a acquis le moteur de calcul de KizunOrca pour le commercialiser. Ce moteur est désormais la propriété exclusive d'Orcadeep :
> son architecture, son code et ses réglages ne sont plus documentés ni distribués dans ce dépôt.

## Le moteur de calcul (propriété d'Orcadeep)
KizunOrca s'appuie sur le moteur de calcul d'Orcadeep pour la simulation hydraulique, l'import et l'export EPANET `.inp`
et l'optimisation du dimensionnement sous contraintes (pression minimale, vitesse maximale, facteur de pointe).
Les réseaux optimisés sont réexportés en `.inp`, donc vérifiables dans EPANET sans accès au moteur.

## Volontairement retiré
- **Comptes, quotas, plateforme web** : une application de bureau hors ligne d'abord est plus convaincante en démo et pour un bureau d'études qui ne veut pas envoyer ses réseaux dans le cloud.
- **Les modules hors du sujet du pitch** : transitoires, assainissement, calage.

## Ce que KizunOrca ajoute
1. **Réseau posé sous les vraies rues.** Graphe OpenStreetMap et altitudes Open-Meteo ([src/generate.ts](../src/generate.ts), [src/streets.ts](../src/streets.ts)).
2. **Agent IA rapide.** Claude ne rend que l'intention, environ 100 jetons, et le générateur construit le réseau ([src/intent.ts](../src/intent.ts)).
3. **Rapport avant / après au débit de pointe.** Coût en TND, vitesses, pressions, débits ([src/net.ts](../src/net.ts) `peakStats`).
