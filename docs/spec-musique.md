# Spec — Fin de partie live : « Sounds on », montage house synchronisé, pistes réparties entre téléphones

Statut : validée par le produit (Stéphane, 22/11/2026). À implémenter par l'agent de code.
Dépend de : rien de bloquant. S'articule avec `docs/spec-soutien.md` (la phase `patron` vient **après** le montage).
Prototype de référence (structure, tempo, accords, découpage en pistes) : `tools/music/afrohouse.html`
(rendus d'écoute : `tools/music/rendus/`). **Le son du prototype est jugé « cheap » : il ne doit pas partir en prod tel quel** (voir §4).

---

## 0. Résumé

1. **100 % live** : on ne rejoint une partie qu'en scannant le QR code sur place. Plus de lien à envoyer.
2. Avant le montage de fin, un écran **« 🔊 Sounds on »** de ~6 s, pendant lequel la musique **démarre déjà** (intro filtrée, « préparatoire »).
3. La musique est une **afro house tech joyeuse** à **124 BPM**, en deux longueurs : **20 s** (peu de photos) ou **30 s** (assez de photos), « Sounds on » compris.
4. La musique et les images sont **synchronisées sur tous les téléphones** (horloge commune, départ programmé).
5. Le morceau est découpé en **6 pistes** ; chaque téléphone joue **sa** partie en avant + le **mix complet très bas** (fond de sécurité).
6. Les photos du montage sont **scorées** ; la **meilleure tombe pile sur le drop**.

Contraintes : aucune donnée collectée ; interface identique en local et en prod ; ne jamais casser la fin de partie si l'audio échoue (le montage doit défiler même sans son).

---

## 1. 100 % live : retirer le lien d'invitation

- Dans le salon (`lobbyScreen()` de `js/app.js`) : supprimer la ligne « Tes potes ne sont pas avec toi ? Envoie-leur un lien » (`<p class="remote">`, bouton `data-act="share"`), son gestionnaire de clic (`navigator.share` / copie presse-papiers) et le CSS `.join-qr .remote`.
- `js/i18n.js` (FR + EN) : supprimer `remoteFriends`, `sendLink`, `inviteText`, `linkCopied` s'ils ne servent plus ailleurs (vérifier avec `grep`).
- Garder `inviteUrl()` : il sert à fabriquer l'URL du QR code (`?p=CODE`).
- Le partage du **jeu** en fin de partie (`share-game`) n'est pas concerné : on le garde.
- Pages `confidentialite.html` / `privacy.html`, section « Qui peut entrer » : retirer la mention du lien envoyé par l'hôte et le conseil « envoie le lien seulement aux joueurs » ; on n'entre qu'en scannant le QR code affiché sur le téléphone de l'hôte. Mettre à jour la date.
- `README.md` : retirer la mention « Envoie-leur un lien ».
- Tests : `tools/test-devices.mjs` ne doit plus chercher ce bouton.

---

## 2. Déroulé de fin de partie

```
ranking (dernière manche)
  → soundson   (NOUVELLE PHASE, ~5,8 s = 3 mesures)   musique : intro filtrée qui s'ouvre
  → montage    (14,2 s ou 24,2 s)                      musique : suite du même morceau, sans coupure
  → patron     (cf. spec-soutien, si actif)
  → end
```

- `soundson` + `montage` = **un seul morceau continu** de 20 s (10 mesures) ou 30 s (15 mesures). L'écran change à la fin de la mesure 3, la musique ne s'interrompt pas.
- Si le montage n'a pas lieu (pas assez de médias ou réglage `slideshow` désactivé, cf. `montageItems()` et `MONTAGE_MIN_ITEMS`) : pas de `soundson`, pas de musique, on passe directement à la suite comme aujourd'hui.
- L'hôte garde le bouton « Passer » (`data-act="skip"`) pendant `soundson` et `montage` : il coupe la musique partout (fondu de 0,3 s) et passe à la suite.

### 2.1 Durées (124 BPM, 1 mesure = 16 doubles-croches = 1,935 s)

| Version | Condition | Mesures | Durée totale | `soundson` | `montage` |
|---|---|---|---|---|---|
| Courte | moins de **10** photos retenues | 10 | 19,35 s | mesures 1–3 (5,81 s) | mesures 4–10 (13,55 s) + traîne 1 s |
| Longue | **10** photos retenues ou plus | 15 | 29,03 s | mesures 1–3 | mesures 4–15 (23,23 s) + traîne 1 s |

- Constantes dans `js/game.js` : `MUSIC_BPM = 124`, `PREP_BARS = 3`, `SHORT_BARS = 10`, `LONG_BARS = 15`, `LONG_MIN_PHOTOS = 10`.
- `MONTAGE_MS` (aujourd'hui fixe à 15 000) devient une durée **calculée** et **stockée dans l'état** (`this.music = { version: 'short' | 'long', startAt, bars }`), envoyée dans la vue, sauvegardée dans le snapshot pour la reprise.

### 2.2 Arrangement (repris du prototype)

Courte : `prep0 prep1 prep2 | drop drop drop drop drop drop | outro`
Longue : `prep0 prep1 prep2 | groove groove groove groove | build | drop drop drop drop drop drop | outro`

- `prep0` : mélodie seule + shaker, filtre général fermé (~700 Hz).
- `prep1` : + congas, rim ; le filtre s'ouvre (→ 1 600 Hz).
- `prep2` : + charleston, montée (riser) ; le filtre s'ouvre (→ 5 000 Hz).
- `groove` (longue) : kick, basse, percus, mélodie, sans accords ; filtre à ~9 kHz.
- `build` (longue) : plus de kick, roulement de claps qui s'accélère, riser, filtre qui s'ouvre en grand.
- `drop` : tout, accords compris, crash sur la 1re mesure ; « pompe » (sidechain) sur basse/accords/mélodie.
- `outro` : accord tenu, 3 notes de mélodie qui descendent, kick sur le 1er temps, filtre qui se referme, fondu 1,2 s.

---

## 3. Écran « 🔊 Sounds on » (phase `soundson`)

- Plein écran, fond de l'app. Gros « 🔊 » animé (ondes qui pulsent au tempo : 1 pulsation par temps = 0,484 s).
- Titre : « Sounds on ! » (FR et EN identiques), sous-titre : FR « Monte le son et pose ton tel sur la table » / EN « Turn it up and put your phone on the table ».
- Ligne de rôle (cf. §6) : FR « Toi, tu joues : {piste} » / EN « You're playing: {track} », avec l'icône de la piste.
- Compte à rebours discret sur les 4 derniers temps (« 4 3 2 1 »), puis bascule sur le montage pile au début de la mesure 4.
- Si l'audio est bloqué (iOS sans geste préalable, `AudioContext.state !== 'running'`) : afficher un gros bouton « 🔊 Activer le son » ; au toucher, `ctx.resume()` et la musique **rejoint en cours** (calée sur l'horloge commune, pas depuis le début).

---

## 4. Source audio : pistes en fichiers (prod) et synthèse (dépannage)

### 4.1 Prod : 6 pistes audio fournies par le produit
- Le morceau définitif sera **produit hors du code** (producteur ou outil avec droits commerciaux clairs) et livré en **12 fichiers** : 6 pistes × 2 versions, même début, même tempo, même grille que le prototype.
- Format : `audio/fin/{short|long}-{kick|bass|perc|chords|lead|fx}.m4a` (AAC, 128 kb/s, mono sauf `fx` et `chords` stéréo possibles), + `audio/fin/{short|long}-mix.m4a` (mix complet, pour le fond de sécurité et le téléphone seul). Ajouter une entrée `!audio/fin/*` dans `.gitignore` si besoin, et autoriser le chemin dans `serve.py` (`ALLOWED`).
- Chargement : pendant le **salon** et les manches, en tâche de fond, **uniquement** la version probable + la piste attribuée + le mix (≈ 3 fichiers, < 1 Mo). Décodage par `ctx.decodeAudioData`. Si un fichier manque au moment du départ : jouer la synthèse (§4.2) pour ce téléphone.
- Le code ne doit dépendre ni du nom du producteur ni d'un format propriétaire.

### 4.2 Dépannage : synthèse dans le navigateur
- Porter le moteur du prototype (`tools/music/afrohouse.html`) dans un module `js/music.js` qui remplace `js/phonk.js` (`playPhonk`, `renderPhonk` utilisés par `js/app.js` et `tools/video/render.mjs` : adapter ces deux appelants).
- Même API que les fichiers (§5) : `scheduleTrack({ version, stems, at, mixLevel })`.
- Sert tant que les fichiers ne sont pas livrés, et en secours si un fichier ne charge pas.

---

## 5. Synchronisation entre téléphones

### 5.1 Horloge commune (js/net.js)
- Pendant le salon, chaque invité mesure l'écart d'horloge avec l'hôte par le canal de données existant :
  - invité → hôte `{t:'ping', a: performance.now()}` ; hôte → invité `{t:'pong', a, h: hostNow()}` ; à réception, `rtt = now − a`, `offset = h + rtt/2 − now`.
  - 8 échantillons espacés de 150 ms à la connexion, puis en continu pendant toute la partie (cf. §5.4).
  - `hostNow()` = `performance.now()` de l'hôte. `toLocal(hostTime) = hostTime − offset`.
- L'hôte n'a pas d'offset (0).

### 5.2 Départ programmé
- À l'entrée en `soundson`, l'hôte fixe `music.startAt = hostNow() + 1500` (ms) et l'envoie dans la vue avec `version` et l'attribution des pistes.
- Chaque téléphone convertit en temps audio : `t0 = ctx.currentTime + (toLocal(startAt) − performance.now()) / 1000 − outputLatency`, avec `outputLatency = ctx.outputLatency || ctx.baseLatency || 0`.
- Toute la musique (fichiers via `AudioBufferSourceNode.start(t0)`, ou synthèse planifiée) part à `t0`.
- **Les écrans suivent la même horloge** : bascule `soundson → montage` et chaque changement de photo sont calculés depuis `startAt` (pas depuis l'arrivée des messages). Le timer de l'hôte qui termine le montage se base aussi sur `startAt`.
- Arrivée en retard (reconnexion, son activé après coup) : démarrer les sources avec un décalage (`start(now, elapsed)`) pour rejoindre en cours.

### 5.3 Objectif et limites
- Objectif : écart ≤ 30 ms entre téléphones sur le même Wi-Fi.
- Bluetooth (enceinte, écouteurs) et latences de sortie mal déclarées par le navigateur : non mesurables sans micro, acceptés en V1 (§5.4).
- iPhone en mode silencieux : utiliser `navigator.audioSession.type = 'playback'` quand disponible (Safari récent), avant de créer/reprendre le contexte audio.

### 5.4 Calibrage : invisible, pendant la partie

Pas d'étape dédiée, pas d'écran, pas de micro. Le calage se fait **en tâche de fond pendant toute la partie**, pour être parfait au moment du « Sounds on » :
- Les échanges `ping`/`pong` du §5.1 tournent dès la connexion au salon et **pendant les manches** : 1 toutes les 2 s (au lieu de 10 s), sur le canal de données existant, quelques octets à chaque fois.
- On garde une **fenêtre glissante des 30 derniers échantillons** ; l'offset retenu est la médiane des offsets des 8 échantillons au **RTT le plus court** (ceux que le réseau a le moins retardés).
- **Dérive d'horloge** : on estime aussi la pente (offset en fonction du temps, régression sur la fenêtre) pour corriger la dérive entre les quartz des téléphones sur une partie longue.
- Quand le téléphone revient de veille ou se reconnecte : on vide la fenêtre et on refait une rafale de 8 échantillons espacés de 150 ms.
- **Latence de sortie** : `ctx.outputLatency` (ou `baseLatency`) relue juste avant le départ de la musique, et à chaque `devicechange`.
- À l'entrée en `soundson`, chaque invité renvoie à l'hôte la qualité de son calage (RTT minimal, écart-type) ; si un téléphone est mal calé (RTT minimal > 80 ms), l'hôte lui attribue de préférence une piste peu rythmique (`chords` ou `fx`) plutôt que `kick`/`perc`.
- Bluetooth : non mesurable sans micro, accepté en V1. Le fond de sécurité (mix complet à −18 dB) limite l'effet.

Calibrage acoustique au micro : **hors périmètre** (idée gardée pour plus tard si la synchro réelle s'avère insuffisante).

---

## 6. Répartition des pistes entre téléphones

### 6.1 Les 6 pistes
| id | Piste | Icône |
|---|---|---|
| `kick` | Kick | 🥁 |
| `bass` | Basse | 🎸 |
| `perc` | Percus (clap, charleston, shaker, congas, rim) | 🪘 |
| `chords` | Accords | 🎹 |
| `lead` | Mélodie | 🎶 |
| `fx` | Effets (montées, crash, coupures) | ✨ |

### 6.2 Attribution (par l'hôte, au départ de `soundson`)
Téléphones **connectés** triés : hôte d'abord, puis ordre d'arrivée dans le salon.

| Téléphones | A (hôte) | B | C | D | E | F |
|---|---|---|---|---|---|---|
| 1 | mix complet | | | | | |
| 2 | kick, basse, percus | accords, mélodie, effets | | | | |
| 3 | kick, percus | basse, accords | mélodie, effets | | | |
| 4 | kick, percus | basse | accords | mélodie, effets | | |
| 5 | kick | percus | basse | accords | mélodie, effets | |
| 6 | kick | percus | basse | accords | mélodie | effets |
| 7+ | les suivants doublent dans cet ordre : mélodie, percus, accords, mélodie, percus… |

- Chaque téléphone joue : **ses pistes à 0 dB** + **le mix complet à −18 dB** (fond de sécurité). Téléphone seul : mix complet à 0 dB.
- Déconnexion d'un téléphone pendant la musique : l'hôte réattribue ses pistes au téléphone qui en a le moins, **à la mesure suivante** (bascule de gain avec rampe de 20 ms, calée sur `startAt + n × mesure`).
- Vue : `v.music = { version, startAt, bars, mine: ['kick', 'perc'], solo: bool }`.

---

## 7. Photos du montage : score et placement

### 7.1 Score (js/records.js)
Point de départ existant : `photoReactions()` (réactions du groupe dans les messages qui suivent, `burst` = rafale) et `bestPhotos()`.
- Score = `score` des réactions, divisé par `1 + 0.5 × (burst − 1)` (une photo isolée vaut plus qu'une parmi douze).
- **Plus de `Math.random()`** dans le score ; le hasard sert seulement à départager les égalités.
- **Au plus 3 photos par auteur.**
- **Étalement** : si deux photos retenues sont du même jour, préférer la suivante du classement d'un autre jour tant que l'écart de score reste < 20 %.
- Une photo **sans aucune réaction** n'est retenue que s'il en manque pour atteindre 6.
- Les stickers / GIF fétiches (`extras` de `montageItems`) restent, mais ne comptent pas dans le seuil des 10 photos.

### 7.2 Placement sur la musique
- Version courte : la **meilleure photo** s'affiche au **1er temps de la mesure 4** (le drop), puis une photo **par temps** dans l'ordre décroissant des scores ; à court de photos, reboucler sur les meilleures ; stickers/GIF intercalés tous les 4 temps.
- Version longue : `groove` (mesures 4–7) avec les photos les moins bien classées, une **tous les 2 temps** ; `build` (mesure 8) : la même photo reste avec un zoom qui s'accélère ; **meilleure photo au 1er temps du drop (mesure 9)** ; puis une par temps, ordre décroissant.
- `outro` : dernière image = la meilleure photo en fond flou + « Who is bro ? ».
- Les messages cultes (`montageQuotes`) gardent leur place actuelle s'il en reste, sinon on les retire.

---

## 8. Messages réseau (nouveaux)

| Message | Sens | Effet |
|---|---|---|
| `{t:'ping', a}` | invité → hôte | répondre `pong` |
| `{t:'pong', a, h}` | hôte → invité | mise à jour de l'offset |
| `{t:'sync-quality', rtt, jitter}` | invité → hôte | qualité du calage, pour l'attribution des pistes |

Le reste passe par la vue (`v.music`).

---

## 9. Textes (js/i18n.js)

| Clé | FR | EN |
|---|---|---|
| soundsOn | Sounds on ! | Sounds on! |
| soundsOnHint | Monte le son et pose ton tel sur la table | Turn it up and put your phone on the table |
| yourTrack | t => `Toi, tu joues : ${t}` | t => `You're playing: ${t}` |
| enableSound | 🔊 Activer le son | 🔊 Turn on sound |
| trackKick / trackBass / trackPerc / trackChords / trackLead / trackFx / trackAll | le kick / la basse / les percus / les accords / la mélodie / les effets / tout le morceau | the kick / the bass / the percussion / the chords / the melody / the effects / the whole track |

---

## 10. Tests

- `tools/test-game.mjs` : choix de la version (9 photos → courte, 10 → longue) ; attribution des pistes pour 1 à 9 téléphones (table §6.2) ; réattribution après déconnexion ; score des photos (max 3 par auteur, rafales pénalisées, pas de hasard hors égalités, meilleure photo au drop).
- `tools/test-devices.mjs` : la fin passe par `soundson` puis `montage` ; plus de bouton « Envoie-leur un lien » ; pas d'erreur JS si l'audio est bloqué (Playwright sans geste) ; le montage défile même sans son.
- Mesure de synchro : petit outil `tools/sync-check.html` (hors prod) qui affiche sur chaque téléphone un flash plein écran à chaque temps à partir de `startAt` ; vérifier à l'œil / à la caméra ralentie sur 3–4 vrais téléphones (iPhone + Android) sur le même Wi-Fi.
- Vérifier que le « Passer » de l'hôte coupe la musique partout.

---

## 11. Hors périmètre (V1)

- Réglage manuel du décalage Bluetooth.
- Musique différente selon le groupe.
- Choix du morceau par l'hôte.

---

## 12. Livrables attendus du produit (non bloquants pour le développement)

- Les 14 fichiers audio (§4.1), produits sur la base de `tools/music/afrohouse.html` : 124 BPM, la majeur (A – F#m – D – E, 1 accord par mesure), mêmes sections et mêmes longueurs (10 et 15 mesures), intro « préparatoire » filtrée sur 3 mesures, drop au début de la mesure 4 (courte) / 9 (longue), avec des **droits d'usage commercial clairs**.
- En attendant : synthèse (§4.2).
