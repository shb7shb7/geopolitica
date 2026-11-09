# Geopolitica

Business game de conquête en temps réel : 25 nations, 6 années d'économie, une négociation, puis une guerre mondiale sur une vraie carte du monde.

## Les 3 liens

| Page | URL | Pour qui |
|---|---|---|
| Joueurs | `/` | Chaque équipe, sur téléphone (QR code affiché sur l'écran) |
| Maître du jeu | `/mj` | L'animateur (protégé par PIN) |
| Écran de projection | `/screen` | Le vidéoprojecteur (cliquer une fois pour le son, `F` = plein écran) |

## Déroulé d'une partie

1. **MJ** : *Ouvrir les inscriptions* → un code de session s'affiche sur l'écran.
2. **Équipes** : scannent le QR code, entrent un nom, choisissent une nation.
3. **MJ** : *Manche test* (facultatif) puis *Lancer la période 1*.
4. 6 périodes : chaque période affiche un indice sur l'événement qui frappera au début de la suivante. 2 actions d'achat par période, vente libre. Armée débloquée en période 5.
5. **Négociation** : alliances (non-agression ou offensive) et derniers investissements militaires.
6. **Guerre** : tour par tour (45 s) — attaquer, se fortifier ou passer. Premier assaut = pillage, second = annexion (le territoire change de couleur). Fin : dernier survivant, double victoire en non-agression, ou la plus puissante après 6 manches.

## Déploiement sur Render

1. Sur [Render](https://dashboard.render.com) : **New + → Blueprint**, choisir ce dépôt GitHub. Render lit `render.yaml`.
2. Saisir la variable **`MJ_PIN`** (6 chiffres ou plus) quand Render la demande.
3. Une fois déployé : `https://<votre-service>.onrender.com/`, `/mj`, `/screen`.

> Vercel ne convient pas : le jeu a besoin d'un serveur Node allumé en permanence (WebSockets + état en mémoire).
> Sur l'offre gratuite de Render, le service s'endort après 15 min sans visite : ouvrez `/screen` quelques minutes avant la partie pour le réveiller.

## Développement

```bash
npm install
MJ_PIN=123456 npm run dev     # http://localhost:3000
npm test                      # tests des règles du jeu
npm run build:assets          # régénère la carte (public/data/world.json) et les drapeaux
```

Sans `MJ_PIN`, un PIN aléatoire est affiché dans la console au démarrage. L'état de la partie est sauvegardé dans `data/state.json` (rechargé en pause après un redémarrage).

## Organisation

- `src/config.js` — toutes les règles chiffrées (prix, coûts, durées…)
- `src/data/` — nations et événements
- `src/game.js` — moteur du jeu (testé dans `test/`)
- `src/sockets.js` — authentification, validation, vues par rôle
- `public/` — pages joueur (`index.html`), MJ (`mj.html`), écran (`screen.html`)
