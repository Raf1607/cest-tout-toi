# Who is bro ?

Jeu d'ambiance pour un groupe WhatsApp, à partir de 2 joueurs, chacun sur son téléphone.

**Jouer : https://raf1607.github.io/cest-tout-toi/**

## Lancer une partie

1. **Exporter la discussion** (sur le téléphone de l'hôte) : dans WhatsApp, ouvrir le groupe, toucher son nom en haut, *Exporter la discussion* › *Joindre les médias* (ou *Sans médias*) › *Enregistrer dans Fichiers*. Sur Android : menu ⋮ › *Plus* › *Exporter la discussion*. Avec les médias, le jeu montre en plus les stickers et GIF fétiches de chacun ; le fichier est plus gros et WhatsApp n'y garde que les messages les plus récents.
2. **Créer la partie** : ouvrir le lien du jeu, toucher *Importer la discussion* et choisir le fichier exporté. Le téléphone affiche un code de 4 lettres et un QR code. Astuce iPhone : Partager › *Sur l'écran d'accueil* pour avoir le jeu comme une appli.
3. **Faire entrer les autres** : ils scannent le QR code (ou tapent le code), en Wi-Fi ou en 4G, et choisissent qui ils sont dans la discussion.
4. **Lancer** : l'hôte règle le nombre de manches et le temps de vote, puis touche *Lancer la partie*. Le bouton s'active quand chaque joueur a choisi son nom ; pas besoin que tous les membres du groupe soient là (l'option *Inclure les membres absents* les ajoute quand même au jeu).

À chaque manche, une expression (ou une façon de commencer ou finir ses messages), un vrai message typique de quelqu'un (« qui a écrit ça ? ») ou le message culte du groupe, un emoji, un sticker, un GIF ou une habitude (« qui envoie le plus de vocaux ? »), un emoji préféré ou un titre (le fantôme du groupe, celui qui ne s'arrête jamais de parler, l'explosif en majuscules, qui répond le plus vite, qui relance le groupe, qui a le dernier mot, qui écrit la nuit, qui rit de tout…) s'affiche sur tous les téléphones : chacun vote pour celui ou celle qui la dit tout le temps. On voit en direct qui vote pour qui, et on peut changer d'avis jusqu'à la fin ; quand tout le monde a voté, il reste 5 secondes. 2 points par bonne réponse, 1 point en moins par mauvaise (jamais en dessous de zéro), et le classement s'anime après chaque manche. L'hôte passe à la manche suivante quand le groupe est prêt. À la fin, avec un export avec médias, un diaporama fait défiler les photos qui ont le plus fait réagir le groupe, avec les emojis envoyés juste après (option de l'hôte, activée par défaut).

**Pendant la partie, l'hôte garde la page ouverte et l'écran allumé** (sur iPhone, mettre le verrouillage automatique sur *Jamais* par sécurité) : si sa page se ferme, la partie s'arrête. Les autres peuvent recharger la page, ils reviennent avec leur nom et leur score.

## Comment ça marche

- **Aucun serveur de jeu.** Le téléphone de l'hôte tient la partie ; les autres s'y connectent en pair-à-pair (WebRTC, via [PeerJS](https://peerjs.com) et son serveur public de mise en relation, qui ne voit pas le contenu des échanges).
- **La discussion ne quitte pas le téléphone de l'hôte.** Elle est lue et analysée dans la page, sans être envoyée nulle part ni conservée. Les invités ne reçoivent que la liste des membres, l'expression de la manche, puis à la révélation un message d'exemple et les chiffres.
- **Médias** : les habitudes viennent des mentions « autocollant omis », « GIF retiré »… (iPhone ; Android n'indique que « médias »). Dans un export avec médias, le même sticker envoyé plusieurs fois est reconnu à sa taille et son CRC (lus dans le sommaire du zip, sans tout décompresser) ; l'image de la manche part vers les autres téléphones en petits morceaux. Les questions sur les photos sont une option de l'hôte, désactivée par défaut : n'importe quelle photo du groupe peut alors s'afficher.
- **Aucune vraie discussion dans ce dépôt.** `samples/` ne contient que des discussions inventées, et le `.gitignore` refuse tout autre fichier `.txt` ou `.zip`.
- **Détection des tics** (`js/tics.js`) : pour chaque membre, les mots et expressions (jusqu'à 5 mots) que lui seul ou presque emploie : au moins 85 % des utilisations doivent venir de lui, seuil assoupli si un groupe n'en a pas assez. Les emojis, eux, suivent une règle plus souple. Sont écartés : les mots de tous les jours (« ok », « quoi »…), les tournures limitées à une seule conversation (un sujet, pas un tic), les prénoms et noms propres, et les bouts de phrase collés par hasard (« jeudi mdrrr »).

## Modifier le jeu

Tester une modification sur l'ordinateur avant de la publier :

```bash
python3 serve.py
```

Puis http://localhost:8790. « Essayer avec une discussion d'exemple » lance une partie sur `samples/`, que l'on peut rejoindre depuis un autre onglet. Les téléphones branchés au même Wi-Fi peuvent aussi l'ouvrir, à l'adresse affichée par le serveur (macOS peut demander d'autoriser les connexions entrantes pour Python). Ça sert aussi de solution de secours si GitHub Pages n'est pas disponible.

Publier la nouvelle version (avec le compte GitHub de Raph ; le site se met à jour en une minute environ) :

```bash
gh auth switch --user Raf1607
node tools/version.mjs   # nouvelle version des scripts : les téléphones ne gardent pas l'ancienne en cache
git add -A && git commit -m "Ce qui a changé" && git push
```

Outils :

```bash
node tools/test-game.mjs                                       # partie simulée
node tools/check.mjs "chemin/vers/Discussion WhatsApp avec ….txt"  # tics trouvés dans un export
node tools/make-sample.mjs                                     # régénère samples/
```

## Fichiers

| | |
|---|---|
| `index.html` | page et styles |
| `js/whatsapp.js` | lecture des exports iPhone et Android |
| `js/tics.js` | détection des tics |
| `js/game.js` | règles et déroulé de la partie (côté hôte) |
| `js/net.js` | connexions pair-à-pair |
| `js/records.js` | records (vitesse de réponse, relances, nuit…) et emoji préféré |
| `js/media.js` | lecture du zip, préparation et envoi des images |
| `js/app.js` | écrans |
| `serve.py` | serveur local pour tester |
| `tools/` | partie simulée, analyse d'un export, génération des exemples |
| `samples/` | discussions inventées pour la démo et les tests |
