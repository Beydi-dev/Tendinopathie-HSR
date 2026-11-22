# Genoux HSR

Application web installable (PWA) de suivi de rééducation des tendons rotuliens,
selon le protocole Heavy Slow Resistance : 3 exercices, 12 paliers, progression
de charge pilotée par la douleur (pain monitoring model).

**Démo :** https://<ton-pseudo>.github.io/genoux-hsr/

## Fonctionnalités
- Séance du jour pré-remplie (palier, séries × reps, charges)
- Douleur par genou pendant la séance et le lendemain matin
- Décision automatique : progresser, garder la charge, reculer ; avancer, prolonger ou reculer d'un palier
- 1RM estimé par la formule d'Epley (pas de test max)
- Graphiques SVG faits main, historique, export / import JSON
- Fonctionne hors ligne, installable sur l'écran d'accueil, thème clair / sombre

## Structure
| Fichier | Rôle |
|---|---|
| `engine.js` | Règles métier, fonctions pures, sans DOM ni stockage |
| `app.js` | Stockage, rendu des écrans, actions |
| `style.css` | Mise en page et thèmes |
| `index.html` | Squelette, chargement des scripts |
| `sw.js` | Service worker (cache hors ligne) |
| `tests/engine.test.js` | Tests unitaires du moteur |

## Lancer
- En local : `python3 -m http.server` puis http://localhost:8000
- Tests : `node --test tests/engine.test.js`

Stack : HTML, CSS et JavaScript sans framework ni dépendance.

> Outil de suivi personnel, ne remplace pas l'avis d'un kinésithérapeute.
