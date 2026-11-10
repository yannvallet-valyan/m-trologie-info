---
title: Incertitude de mesure : comprendre et calculer (GUM, type A et B)
description: Guide pratique de l'incertitude de mesure : définition, incertitude-type de type A et B, composition, incertitude élargie et facteur d'élargissement, avec un exemple chiffré.
date: 2026-10-15
category: Incertitudes
related: etalonnage-verification-calibration,raccordement-metrologique-tracabilite,norme-iso-17025-et-iso-10012
---

## Pourquoi parler d'incertitude

Aucune mesure n'est parfaite. L'**incertitude de mesure** quantifie le doute sur le résultat : un résultat sans incertitude est incomplet. Écrire « 10,02 mm » ne veut rien dire tant qu'on ne sait pas si c'est ±0,01 mm ou ±0,5 mm.

La méthode de référence est le **GUM** (*Guide to the expression of Uncertainty in Measurement*, JCGM 100), qui décrit comment évaluer et exprimer l'incertitude.

## Erreur et incertitude : ne pas confondre

- L'**erreur** est l'écart entre la valeur mesurée et la valeur vraie (inconnue en pratique).
- L'**incertitude** est un intervalle autour du résultat dans lequel la valeur vraie se trouve avec une probabilité donnée.

## Les étapes de l'évaluation

1. **Définir le mesurande** et le modèle de mesure.
2. **Identifier les sources d'incertitude** : étalon, résolution, répétabilité, température, opérateur, etc.
3. **Évaluer chaque composante** en incertitude-type.
4. **Composer** les incertitudes-types.
5. **Élargir** avec un facteur k pour obtenir l'incertitude élargie.

## Type A et type B

| | Type A | Type B |
|---|---|---|
| Méthode | Analyse statistique de mesures répétées | Autres informations : certificat, notice, expérience |
| Calcul | Écart-type expérimental de la moyenne : s/√n | Loi de distribution supposée (rectangulaire, normale…) |

Pour une loi **rectangulaire** de demi-largeur *a* (par exemple une résolution), l'incertitude-type vaut *a* / √3.

## Composition et incertitude élargie

Pour des grandeurs indépendantes, l'incertitude-type composée est la racine de la somme quadratique des composantes :

`u_c = √(u₁² + u₂² + … + uₙ²)`

L'incertitude élargie vaut `U = k × u_c`. Avec **k = 2**, on obtient environ **95 %** de niveau de confiance pour une loi normale.

## Exemple chiffré

Mesure d'une longueur avec un pied à coulisse de résolution 0,01 mm.

| Composante | Valeur | Incertitude-type |
|---|---|---|
| Répétabilité (type A, 10 mesures) | s/√n | 0,004 mm |
| Résolution (type B, rectangulaire) | 0,005/√3 | 0,0029 mm |
| Étalonnage de l'instrument (type B, U = 0,02 mm, k = 2) | 0,02/2 | 0,010 mm |

`u_c = √(0,004² + 0,0029² + 0,010²) ≈ 0,011 mm`, donc `U = 2 × 0,011 ≈ 0,022 mm` (k = 2).

Le résultat s'exprime ainsi : **L = 25,03 mm ± 0,022 mm (k = 2)**.

## Incertitude et décision de conformité

Si une pièce doit mesurer 25,00 ± 0,05 mm et que le résultat est 25,03 ± 0,022 mm, la pièce est conforme avec une marge. Mais près de la limite, l'incertitude peut empêcher de conclure. Des règles de décision (ILAC-G8, JCGM 106) définissent la marche à suivre, par exemple avec une **bande de garde**.

## Questions fréquentes

### Quelle valeur de k choisir ?

k = 2 est le choix courant pour un niveau de confiance d'environ 95 %. Pour peu de mesures, on utilise le facteur de Student.

### L'incertitude diminue-t-elle si je répète les mesures ?

Seule la composante de répétabilité diminue (en 1/√n). Les composantes systématiques, comme l'incertitude de l'étalon, restent.

### Un instrument plus précis suffit-il ?

Il réduit une composante, mais l'incertitude dépend de l'ensemble du processus : méthode, environnement, opérateur.
