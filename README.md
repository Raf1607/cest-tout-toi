# Who is bro ?

Jeu d'ambiance pour un groupe WhatsApp, à partir de 2 joueurs, chacun sur son téléphone. En français et en anglais.

**Jouer : https://whoisbro.lol**

## Lancer une partie

1. **Exporter la discussion** (sur le téléphone de l'hôte) : dans WhatsApp, ouvrir le groupe, toucher son nom en haut, *Exporter la discussion* › *Tous les médias* (ou *Sans médias*) › *Enregistrer dans Fichiers*. Sur Android : menu ⋮ › *Plus* › *Exporter la discussion*. Avec les médias, c'est bien plus fun (stickers et GIF fétiches, montage photo de fin) ; WhatsApp n'y met que les 10 000 derniers messages environ, contre environ 40 000 sans médias.
2. **Créer la partie** : ouvrir le lien du jeu, toucher *Lancer une partie* et choisir le fichier exporté. Le téléphone affiche un grand QR code (pas de code à taper). Astuce iPhone : Partager › *Sur l'écran d'accueil* pour avoir le jeu comme une appli.
3. **Faire entrer les autres** : ils scannent le QR code avec l'appareil photo de leur téléphone en Wi-Fi ou en 4G, et donnent leur prénom. On ne rejoint une partie que sur place : plus de lien à envoyer. L'hôte accepte chaque demande (et refuse les inconnus) ; chacun choisit ensuite qui il est dans la discussion. Ceux qui ne sont pas dans le groupe touchent *Pas dans le groupe ? Joue quand même* : ils jouent sous leur prénom et marquent des points, sans jamais être une réponse (si presque aucun joueur n'est dans la discussion, les membres absents sont automatiquement de la partie).
4. **Lancer** : l'hôte règle le nombre de manches et le temps de vote, puis touche *Lancer la partie*. Le bouton s'active quand chaque joueur a choisi son nom ; pas besoin que tous les membres du groupe soient là (l'option *Inclure les membres absents* les ajoute quand même au jeu).

À chaque manche, une expression (ou une façon de commencer ou finir ses messages), un vrai message typique de quelqu'un (« qui a écrit ça ? ») ou le message culte du groupe, un emoji, un sticker, un GIF ou une habitude (« qui envoie le plus de vocaux ? »), un emoji préféré ou un titre (le fantôme du groupe, celui qui ne s'arrête jamais de parler, l'explosif en majuscules, qui répond le plus vite, qui relance le groupe, qui a le dernier mot, qui écrit la nuit, qui rit de tout, qui souhaite les anniversaires et la bonne année en premier, qui supprime ses messages, qui les modifie après coup, qui partage le plus de liens…) s'affiche sur tous les téléphones : chacun vote pour celui ou celle qui la dit tout le temps. Dès le premier vote, il ne reste que 7 secondes aux autres, et la manche se termine dès que tout le monde a voté. Un compteur en haut à droite montre combien de joueurs ont déjà voté, mais ni qui ni pour qui ; on peut changer d'avis tant que la manche n'est pas finie. 2 points par bonne réponse, 1 point en moins par mauvaise (jamais en dessous de zéro), et un classement animé de 3 secondes s'affiche entre les manches. Après une manche sur trois en moyenne (jamais après la dernière), une roue de la fortune tombe sur l'une de ses huit cases : *Coup de pouce* (le dernier marque double à la manche suivante), *Course au ×2* (le premier qui trouve marque double), *Roulette* (les prénoms défilent, un joueur au hasard marque double), *Manche double* (+4 et −2 pour tous), *Bouclier* (un joueur au hasard est protégé du prochain malus, jusqu'au tour de roue suivant), *Question bonus* (une manche de plus, une fois par partie), *−2 au premier* (tout de suite) ou *Question floue* (le premier ne voit la question qu'au premier vote). L'hôte passe à la manche suivante quand le groupe est prêt. À la fin, avec un export avec médias, un écran « Sounds on » (montez le son, posez les téléphones sur la table) lance un morceau d'afro house tech joyeuse (128 BPM, synthétisé dans le navigateur, sans droits, les 6 pistes jouent du début à la fin) qui enchaîne sans coupure sur le montage photo : 20 s en tout, ou 30 s à partir de 10 photos. La musique part au même instant sur tous les téléphones (horloge commune mesurée en continu pendant la partie, `js/clock.js`) et le morceau est réparti : chaque téléphone joue sa partie (kick, basse, percus, accords, mélodie ou effets) en avant et le reste très bas. Les images suivent la musique : une photo par temps au drop, la meilleure pile sur le drop (photos classées par les réactions du groupe, rafales pénalisées, 3 par personne au plus). Le montage précède le classement final, où un diaporama fait défiler les photos qui ont le plus fait réagir le groupe, avec les emojis envoyés juste après.

**Pendant la partie, l'hôte garde la page ouverte et l'écran allumé** (sur iPhone, mettre le verrouillage automatique sur *Jamais* par sécurité). S'il recharge la page par erreur, la partie reprend où elle en était, avec le même QR code : son téléphone la garde (IndexedDB, `js/resume.js`) et les invités se reconnectent tout seuls. Si l'onglet de l'hôte est fermé, la partie s'arrête. Le logo en haut des écrans ramène à l'accueil : si l'hôte quitte la partie (après confirmation), elle s'arrête et les invités sont prévenus ; à la fin, chacun a un bouton *Retour à l'accueil*. Les autres peuvent recharger la page, ils reviennent avec leur nom et leur score. Le « tirer pour recharger » est désactivé.

## Comment ça marche

- **Deux langues.** L'accueil suit la langue du téléphone (ou le lien *English* / *Français*, ou `?lang=en`). Une partie se joue dans la langue de l'hôte : les invités basculent dessus en entrant. Tous les textes sont dans `js/i18n.js` ; l'analyse reconnaît d'elle-même une discussion en anglais (exports américains en AM/PM, « image omitted », expressions comme « hold on »).

- **Aucun serveur de jeu.** Le téléphone de l'hôte tient la partie ; les autres s'y connectent en pair-à-pair (WebRTC, via [PeerJS](https://peerjs.com) et son serveur public de mise en relation, qui ne voit pas le contenu des échanges).
- **Parties verrouillées.** Un téléphone qui arrive ne reçoit rien (ni noms, ni messages, ni photos) tant que l'hôte ne l'a pas accepté. Une fois la partie lancée, plus personne de nouveau n'entre ; seuls les joueurs acceptés peuvent revenir après une coupure. Le QR code contient un identifiant de 6 lettres (191 millions de possibilités), jamais affiché, impossible à deviner au hasard.
- **La discussion ne quitte pas le téléphone de l'hôte.** Elle est lue et analysée dans la page, sans être envoyée nulle part ni conservée. Les invités ne reçoivent que la liste des membres, l'expression de la manche, puis à la révélation un message d'exemple et les chiffres.
- **Médias** : les habitudes viennent des mentions « autocollant omis », « GIF retiré »… (iPhone ; Android n'indique que « médias »). Dans un export avec médias, le même sticker envoyé plusieurs fois est reconnu à sa taille et son CRC (lus dans le sommaire du zip, sans tout décompresser) ; l'image de la manche part vers les autres téléphones en petits morceaux. Une seule option pour l'hôte, cochée par défaut : « Inclure des questions sur les membres absents » ; la roue, les questions sur les photos, le montage et le diaporama sont toujours là. Les questions sur les photos (2 à 3 sur 10 manches) préfèrent celles qui ont fait réagir le groupe (emojis et réponses des autres juste après), comme le diaporama de fin.
- **Compteur de parties** : l'accueil affiche le total, tous joueurs confondus, gardé par le service public gratuit [Abacus](https://abacus.jasoncameron.dev). Il reçoit un simple « +1 » à chaque partie lancée (et donc l'adresse IP de l'hôte, comme tout site), rien sur la discussion. Les parties de démo et en local ne comptent pas.
- **Aucune discussion dans ce dépôt, même inventée.** Le `.gitignore` refuse tout fichier `.txt` ou `.zip` et le dossier `samples/` ; les discussions de test se fabriquent à la demande (`tools/make-sample.mjs`, lancé tout seul par les tests).
- **Détection des tics** (`js/tics.js`) : pour chaque membre, les mots et expressions (jusqu'à 5 mots) que lui seul ou presque emploie : au moins 95 % des utilisations doivent venir de lui, seuil assoupli jusqu'à 60 % si un groupe n'en a pas assez (réglages dans `js/tuning.js`). Les emojis, eux, suivent une règle plus souple. Sont écartés : les mots de tous les jours (« ok », « quoi »…), les tournures limitées à une seule conversation (un sujet, pas un tic), les prénoms et noms propres, et les bouts de phrase collés par hasard (« jeudi mdrrr »).
- **Score commun des questions** (`js/scoring.js`) : chaque question possible reçoit une note de 0 à 1, `fun × netteté^0,4 × intensité^0,3 × fiabilité^0,3`. Le fun est une grille fixée à la main (`TUNING.fun`, de 0,42 pour « qui envoie le plus de médias » à 0,80 pour le message culte ou l'explosif) ; la netteté mesure l'écart avec le deuxième (la réponse est-elle juste ?), l'intensité l'écart avec le membre typique (la médiane des autres), la fiabilité le nombre d'occurrences. Titres et habitudes (« qui envoie le plus de vocaux ? ») sont des superlatifs : le gagnant est celui qui en fait le plus, bavard compris, sans autre seuil que des garde-fous (10 % d'avance, 3 occurrences). Pour un « qui a écrit ça ? », la netteté vient de ses tournures typiques et l'intensité des réactions du groupe. Une photo est une bonne question d'office (0,69 sans réaction visible : les réactions par appui long ne sont pas dans l'export), plus encore si elle a été commentée ou envoyée seule plutôt qu'au milieu d'une rafale ; jamais deux photos du même jour dans une partie.
- **Composition de la partie** (`buildDeck` dans `js/game.js`) : 10, 15 ou 20 manches. Le message culte entre d'office, puis chaque catégorie prend ses meilleures questions jusqu'à son plancher (`TUNING.bounds`, par exemple sur 10 manches : messages 2 à 4, titres 2 à 3, photos 2 à 3, tics 2 à 3) ; les manches libres vont aux meilleures questions restantes, toutes catégories confondues, sans dépasser les plafonds. Une personne est la réponse d'au plus un quart des manches (plus s'il y a trop peu de monde), un titre et une habitude par personne sur dix manches, deux messages par personne ; les joueurs présents passent devant les absents et chacun est la réponse d'au moins une manche ; une question sous 0,15 n'est posée que s'il ne reste rien ; une tournure n'est jamais révélée deux fois ; jamais de ponctuation ni de début ou fin de message (presque toujours de faux tics) ; un peu de hasard (±10 %) pour que deux parties sur la même discussion ne soient pas identiques. Ordre : jamais deux fois de suite la même personne, les catégories alternent, la première question porte sur un joueur. Une carte de réserve sert à la *Question bonus*.
- **Soutien en fin de partie** (désactivé pour le moment : `PAYMENTS_ON = false` dans `js/support.js` ; `js/pay.js`, phase `patron` dans `js/game.js`) : après le montage, une roue (pipée) désigne un joueur invité à payer 1 €, jamais un champion ni un absent ; le champion est invité à payer 2 € (« taxe du champion »), les autres jouent gratuitement et peuvent l'encourager. Paiement Apple Pay / Google Pay en un toucher (Stripe Express Checkout, carte en secours), encaissé par Cambon AI ; Stripe.js n'est chargé que sur cet écran. Chaque payeur gagne un badge (👑 Mécène, 💎 Champion diamant) gardé sur son téléphone et affiché à côté de son prénom. Toujours une sortie « Plus tard », jamais de mention de qui n'a pas payé, une seule fois par salon. Sans clé Stripe ni Worker (`worker/`), la fonctionnalité est coupée partout.

## Modifier le jeu

Tester une modification sur l'ordinateur avant de la publier :

```bash
python3 serve.py
```

Puis http://localhost:8790 ; on peut choisir une discussion de `samples/` et rejoindre la partie depuis un autre onglet. Les téléphones branchés au même Wi-Fi peuvent aussi l'ouvrir, à l'adresse affichée par le serveur (macOS peut demander d'autoriser les connexions entrantes pour Python). Ça sert aussi de solution de secours si GitHub Pages n'est pas disponible.

Publier la nouvelle version (avec le compte GitHub de Raph ; le site se met à jour en une minute environ) :

```bash
gh auth switch --user Raf1607
node tools/version.mjs   # nouvelle version des scripts : les téléphones ne gardent pas l'ancienne en cache
git add -A && git commit -m "Ce qui a changé" && git push
```

Outils :

```bash
node tools/test-game.mjs                                       # partie simulée
node tools/test-devices.mjs                                    # vraies parties entre iPhone, Android, Firefox, tablettes (Playwright)
node tools/check.mjs "chemin/vers/Discussion WhatsApp avec ….txt"  # tics trouvés dans un export
node tools/make-sample.mjs                                     # régénère samples/ (les tests le font tout seuls si besoin)
node tools/soutien/demo.mjs                                    # démo du soutien de fin de partie avec un faux Stripe (http://localhost:8795)
# tools/sync-check.html : flash à chaque temps sur chaque téléphone, pour vérifier la synchro (hors prod)
node tools/make-og.mjs                                         # régénère l'image de partage et l'icône
npm install && node tools/video/render.mjs                     # vidéo de présentation 9:16 dans promo/ (non versionnée)
node tools/video/render-howto.mjs                                # tutoriels « Comment ça marche ? » iPhone et Android, FR et EN, dans video/
```

## Fichiers

| | |
|---|---|
| `index.html` | page et styles |
| `og.png`, `apple-touch-icon.png` | aperçu quand on partage le lien, icône d'écran d'accueil (`node tools/make-og.mjs`, depuis `tools/og.html`) |
| `CNAME` | domaine du site (whoisbro.lol), lu par GitHub Pages |
| `qui-sommes-nous.html`, `about.html`, `raph.jpg` | page « Qui sommes-nous ? » en français et en anglais (photo sans métadonnées GPS) |
| `video/who-is-bro.mp4`, `video/who-is-bro-en.mp4` | vidéo de présentation en français et en anglais, liée en bas de l'accueil (copies de `promo/`, après `node tools/video/render.mjs [--lang en]`) |
| `video/howto-{iphone,android}-{fr,en}.mp4` | tutoriels animés (exporter de WhatsApp puis importer), muets, en boucle dans l'écran « Comment ça marche ? » ; source `tools/video/howto.html` |
| `privacy.html` | page « protection des données » en anglais |
| `confidentialite.html` | page « protection des données », liée depuis l'accueil |
| `js/i18n.js` | textes en français et en anglais |
| `js/whatsapp.js` | lecture des exports iPhone et Android |
| `js/tics.js` | détection des tics |
| `js/game.js` | règles et déroulé de la partie (côté hôte) |
| `js/net.js` | connexions pair-à-pair |
| `js/records.js` | records (vitesse de réponse, relances, nuit…) et emoji préféré |
| `js/resume.js` | partie en cours gardée sur le téléphone de l'hôte, pour reprendre après un rechargement |
| `js/music.js` | musique de fin (afro house en 6 pistes, synthétisée en attendant les fichiers audio) |
| `js/clock.js` | horloge commune hôte / invités, pour la musique synchronisée |
| `js/media.js` | lecture du zip, préparation et envoi des images |
| `js/app.js` | écrans |
| `serve.py` | serveur local pour tester |
| `tools/` | partie simulée, analyse d'un export, génération des exemples |
| `js/support.js`, `js/pay.js` | soutien de fin de partie : configuration (clé Stripe, Worker) et paiement |
| `worker/` | Worker Cloudflare qui crée les paiements chez Stripe (voir `worker/README.md`) |
| `js/tuning.js` | réglages du choix des questions (seuils des tics, grille de fun, répartition des manches…) |
| `samples/` | discussions inventées pour les tests, hors de Git, fabriquées à la demande (« Les Potes », « The Crew ») |
