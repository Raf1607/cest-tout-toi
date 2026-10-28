# C'est tout toi !

Jeu d'ambiance pour un groupe WhatsApp, à partir de 2 joueurs, chacun sur son téléphone.

1. L'hôte importe l'export de la discussion du groupe (`.txt` ou `.zip`, « Sans médias »).
2. Le jeu y repère les tics de langage de chacun : mots, expressions, emojis, ponctuation.
3. Les autres rejoignent avec le code à 4 lettres (ou le QR code) et choisissent qui ils sont dans la discussion.
4. À chaque manche, une expression s'affiche sur tous les téléphones : chacun vote pour celui ou celle qui la dit tout le temps. On voit en direct qui vote pour qui, et on peut changer d'avis jusqu'à la fin ; quand tout le monde a voté, il reste 5 secondes. 1 point par bonne réponse.

## Lancer en local

Sur un ordinateur branché au même Wi-Fi que les téléphones :

```bash
python3 serve.py
```

Le serveur affiche l'adresse à ouvrir sur les téléphones (`http://192.168.x.x:8790`) ; http://localhost:8790 sur l'ordinateur montre la même adresse en QR code. L'hôte l'ouvre sur son téléphone et importe la discussion, les autres scannent ensuite le QR code de la partie. Au premier lancement, macOS peut demander d'autoriser les connexions entrantes pour Python : il faut accepter.

Seuls les fichiers du jeu sont servis sur le réseau. Les téléphones ont quand même besoin d'internet : pour se trouver entre eux (serveur de mise en relation de PeerJS) et pour charger les bibliothèques.

« Essayer avec une discussion d'exemple » lance une partie sur `samples/`, que l'on peut rejoindre depuis un autre onglet.

## Comment ça marche

- **Aucun serveur de jeu.** Le téléphone de l'hôte tient la partie ; les autres s'y connectent en pair-à-pair (WebRTC, via [PeerJS](https://peerjs.com) et son serveur public de mise en relation). L'hôte doit garder la page ouverte (l'écran est maintenu allumé quand le navigateur le permet).
- **La discussion ne quitte pas le téléphone de l'hôte.** Les invités ne reçoivent que l'expression de la manche, puis à la révélation un message d'exemple et les chiffres.
- **Détection des tics** (`js/tics.js`) : pour chaque membre, les tournures de 1 à 4 mots, emojis et ponctuations qu'il emploie souvent et au moins 2,5 fois plus que chacun des autres (avec un test statistique pour écarter le hasard). Sont écartées : les tournures limitées à une seule conversation (un sujet, pas un tic), les prénoms et noms propres, les fragments redondants (« du coup » / « coup je suis »).
- Un rechargement de page chez un invité le reconnecte sous le même nom, avec son score.

## Fichiers

| | |
|---|---|
| `serve.py` | serveur local, visible du Wi-Fi |
| `index.html` | page et styles |
| `js/whatsapp.js` | lecture des exports iPhone et Android |
| `js/tics.js` | détection des tics |
| `js/game.js` | règles et déroulé de la partie (côté hôte) |
| `js/net.js` | connexions pair-à-pair |
| `js/app.js` | écrans |
| `tools/` | `make-sample.mjs` (génère `samples/`), `check.mjs` (affiche les tics d'un export), `test-game.mjs` (partie simulée) |

```bash
node tools/check.mjs "chemin/vers/Discussion WhatsApp avec ….txt"
```
