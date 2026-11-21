# À faire — décisions produit en attente d'implémentation

## 100 % live : plus de lien pour rejoindre (22/11/2026)
- Retirer « Tes potes ne sont pas avec toi ? Envoie-leur un lien » du salon (bouton `data-act="share"`, clés `remoteFriends`, `sendLink`, `inviteText`, `linkCopied`).
- On ne rejoint une partie qu'en scannant le QR code sur place.
- Mettre à jour les pages confidentialité FR/EN (« Qui peut entrer » : plus de mention du lien envoyé) et le README.

## « Sounds on » avant le montage (22/11/2026)
- Juste avant le montage photo en musique, afficher pendant **5 s** sur tous les téléphones un écran « 🔊 Sounds on » (montez le son).
- Puis le montage démarre.

## Musique synchronisée sur tous les téléphones (en réflexion)
- Étape 1 : horloge commune hôte/invités + départ programmé de la musique et du montage → plus d'écho.
- Étape 2 : répartir les instruments entre les téléphones (cloche, basse, percussions…) avec un fond complet très bas sur chacun.
- Composition : voir « Montage de fin en house » ci-dessous.

## Montage de fin en house (22/11/2026)
- **Style** : house, 124 BPM, 4 temps (grosse caisse sur chaque temps), synthétisée dans le navigateur comme aujourd'hui (remplace la boucle phonk de `js/phonk.js`).
- **Deux durées**, calées sur des mesures entières (1 mesure ≈ 1,94 s) :
  - **15 s (8 mesures)** si moins de 10 photos retenues : intro 2 mesures (accords filtrés + charleston) → montée 2 mesures (filtre qui s'ouvre, roulement) → **drop** 4 mesures (grosse caisse, basse, clap, accords) → fin coupée net sur le dernier temps.
  - **25 s (13 mesures)** si 10 photos retenues ou plus : intro 2 → couplet 4 (grosse caisse + basse) → montée 2 → **drop** 4 → outro 1 (filtre qui se referme).
- **Les photos suivent la musique** : un changement de photo par temps pendant le drop, toutes les 2 temps ailleurs ; **la meilleure photo tombe pile sur le drop**, les suivantes par score décroissant pendant le drop, les moins bonnes dans l'intro et le couplet.
- **Score des photos** (existe déjà : `photoReactions` / `bestPhotos` dans `js/records.js`, réactions du groupe dans les messages qui suivent). À compléter :
  - pénaliser les rafales (déjà mesurées : `burst`) plus fortement ;
  - au plus 3 photos par auteur, pour que tout le monde passe ;
  - étaler dans le temps (pas deux photos du même jour à la suite si possible) ;
  - ne plus ajouter de hasard (`Math.random()`) sur le score, sauf pour départager des égalités ;
  - seuil minimal : une photo sans aucune réaction ne passe que s'il en manque pour atteindre 6.
- `MONTAGE_MS` devient variable (15 000 ou 25 000 selon le nombre de photos retenues) ; le timer de l'hôte, la reprise et le rendu doivent lire la durée du montage dans la vue.
- « 🔊 Sounds on » (5 s) joue déjà les accords filtrés de l'intro, en fondu, pour donner envie de monter le son.
- À garder en tête pour la répartition entre téléphones : écrire des parties qui sonnent seules sur un petit haut-parleur (basse doublée à l'octave, accords dans le médium).
