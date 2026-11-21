# Spec — Soutien en fin de partie : roue du mécène, paiement Apple Pay / Google Pay, badges

Statut : validée par le produit (Stéphane, 21/11/2026). À implémenter par l'agent de code.
Encaissement : **Cambon AI**, via **Stripe** (compte à créer, clés de test pas encore disponibles).

---

## 0. Résumé

Après le montage photo de fin, une **roue du mécène** (pipée) désigne un joueur invité à payer **1 €**.
Le **champion** est invité à payer **2 €** (« taxe du champion »). Les **autres** jouent gratuitement
(ils peuvent quand même payer 1 €). Le paiement se fait en **un toucher + Face ID / empreinte**
(Apple Pay / Google Pay natifs, dans la page). Chaque payeur gagne un **badge** affiché à côté de
son prénom dans ses parties suivantes : **👑 Mécène** (1 €) ou **💎 Champion diamant** (2 €).

Contraintes non négociables :
- **Aucune donnée collectée** par nous. Pas de cookie, pas de pistage, pas d'analytics. Stripe traite le paiement ; nous ne voyons jamais la carte.
- **Pas de pub.**
- On n'affiche **jamais** qui n'a pas payé. Toujours une sortie « Plus tard », jamais de blocage.
- Aucun paiement ne donne une **chance de gagner** quoi que ce soit (sinon jeu d'argent). La roue ne se paie pas : elle désigne seulement qui est invité à payer.
- Interface iso-prod : pas d'UI réservée au local.

---

## 1. Architecture existante (à connaître)

- Site statique (GitHub Pages, whoisbro.lol), modules ES, import map, cache-busting `?v=` via `node tools/version.mjs`.
- Multijoueur WebRTC (PeerJS) : **l'hôte** porte l'état dans la classe `Game` (`js/game.js`) et envoie à chaque joueur une vue personnalisée (`Game#view(id)`). Les invités envoient des messages `{t: ...}` traités par l'hôte.
- Phases (`game.phase`) : `lobby → question → reveal → ranking → [wheel] → … → montage → end`.
  - `advance()` (js/game.js ~l.475) : après la dernière manche, va en `montage` (si assez de médias) sinon `finish()`.
  - `montage` dure `MONTAGE_MS` (15 s) puis `finish()` → `end`. L'hôte peut passer (`{t:'skip'}`).
  - `end` : écran de fin (`endScreen()` dans js/app.js ~l.937) : diaporama, classement, portraits, Rejouer (hôte), Retour à l'accueil.
- Rendu : `render()` choisit l'écran par `view.phase` (js/app.js ~l.408).
- La roue existante (`wheelScreen()`, `spin()`) est la roue de bonus/malus en cours de partie : **ne pas la modifier** ; s'en inspirer visuellement (CSS `.wheel-box`, `.pointer`, `.lights`…).
- Reprise après rechargement : `snapshot`/`restore` (js/game.js ~l.550). Toute nouvelle donnée d'état de l'hôte doit y être ajoutée.
- i18n : `js/i18n.js`, `tr(lang)(clé, ...args)`, FR et EN obligatoires. La partie est dans la langue de l'hôte.
- Joueurs : `p.author` (membre de la discussion), `p.name`, `p.outside` (joueur extérieur), `p.score`, `p.connected`, `p.host`.

---

## 2. Déroulé de fin de partie (nouveau)

```
ranking (dernière manche, champion révélé)
  → montage (inchangé, 15 s)          ← s'il y a assez de médias
  → patron  (NOUVELLE PHASE)          ← roue du mécène + verdict + paiement
  → end     (écran de fin habituel, avec badges)
```

- Si pas de montage : `ranking → patron → end`.
- La phase `patron` est **sautée** (directement `end`) si :
  - moins de 3 joueurs classés (à 2, la roue désigne forcément l'autre : aucun intérêt) → dans ce cas **afficher quand même l'écran champion** (voir §4.2) et les écrans « gratuit » aux autres, sans roue ;
    → règle précise : `< 2` joueurs classés : sauter `patron` entièrement ; `== 2` : `patron` sans roue (pas de désigné, seulement champion + gratuit) ;
  - la partie a déjà fait une phase `patron` depuis l'ouverture du salon (on ne redemande pas en cas de « Rejouer » dans la même soirée) — garder un flag `this.patronDone` sur l'hôte, persistant dans le snapshot, remis à zéro seulement à la création d'un nouveau `Game`.
- Joueurs « classés » = même filtre que le classement final : `p.author || p.outside`.

### 2.1 Machine d'état de la phase `patron` (côté hôte)

```
patron.step = 'spin'     → durée PATRON_SPIN_MS (≈ 4,5 s), puis
patron.step = 'verdict'  → reste jusqu'à : tout le monde a « continué » OU PATRON_MAX_MS (≈ 60 s) OU l'hôte force
→ finish() → phase 'end'
```

- Chaque joueur passe à l'écran de fin **quand il veut** côté UI (« Plus tard » / « Continuer ») : c'est **local** au téléphone (`ui.patronDismissed = true`), l'hôte n'attend pas tout le monde pour changer l'UI. MAIS la phase de l'hôte reste `patron` tant que :
  - au moins un joueur n'a pas encore quitté son écran de verdict, ET
  - `PATRON_MAX_MS` n'est pas écoulé.
  - Simplification acceptable : l'hôte passe en `end` après `PATRON_MAX_MS` ou dès que tous ont envoyé `{t:'patron-done'}`. Un téléphone déjà « continué » affiche localement l'écran de fin (même rendu que `end`) en attendant.
- Un paiement en cours ne doit **jamais** être interrompu par le passage en `end` : si la feuille Apple Pay est ouverte, on garde l'écran de paiement local jusqu'au résultat, puis on affiche le merci, puis l'écran de fin.

### 2.2 Tirage pipé

```js
const ranked = players.filter(p => p.author || p.outside);
const top = Math.max(...ranked.map(p => p.score));
const champions = ranked.filter(p => p.score === top);          // ex æquo : tous champions
const eligible = ranked.filter(p => p.score !== top && p.connected);
const patronId = eligible.length ? eligible[randomInt(eligible.length)].id : null;
```

- Jamais un champion. Jamais un joueur déconnecté.
- Animation : la roue porte les prénoms de **tous** les joueurs classés (champions inclus, pour le suspense), ralentit en passant sur un champion, et s'arrête sur `patronId`. L'angle final est calculé par l'hôte et envoyé dans la vue (comme `v.wheel.index`) pour que tous les téléphones affichent le même résultat.
- Si `eligible` est vide (tout le monde ex æquo) : pas de roue ; tout le monde est « champion » (écran 2 €).

---

## 3. Vue envoyée aux joueurs (`Game#view`)

Ajouter, quand `phase === 'patron'` :

```js
v.patron = {
  step: 'spin' | 'verdict',
  names: [...],                 // prénoms sur la roue, ordre fixe
  stopIndex: n,                 // index du prénom désigné dans names (null si pas de roue)
  patron: 'Max' | null,         // prénom désigné
  champions: ['Julie'],         // prénoms des champions
  role: 'patron' | 'champion' | 'free',   // rôle DE CE JOUEUR (calculé par id)
  amount: 100 | 200 | 100,      // centimes proposés à ce joueur (free → 100 pour « payer quand même »)
  paid: [{ name: 'Max', badge: 'crown' }, ...],   // payeurs de cette phase, pour les bandeaux
}
```

Et dans **toutes** les vues, chaque joueur de `v.players` porte `badge: 'crown' | 'diamond' | null` (voir §6).

---

## 4. Écrans (js/app.js — nouveau `patronScreen()`)

Style : charte de l'app (fond `--bg`, jaune `--accent`, vert `--good`), police display Bricolage Grotesque. Mobile d'abord, doit tenir sur 375×667 sans défilement.

### 4.1 Étape `spin` (tous les téléphones)
- Logo maison en haut (`homeLogo()`).
- Pastille « Qui va régaler ? ».
- La roue des prénoms (réutiliser le style de `.wheel-box`), pointeur en haut, ralentissement sur le champion, arrêt sur le désigné.
- Respecter `prefers-reduced-motion` : pas de rotation, afficher directement le résultat.

### 4.2 Étape `verdict` — trois écrans selon `v.patron.role`

**A. Désigné (`patron`, 1 €)**
- Pastille « La roue a parlé ».
- Gros 🫵 (apparition en pop).
- Titre : « C'est toi qui régales, {prénom} ! »
- Texte : « Who is bro ? C'est gratuit, sans pub, sans pistage. 1 € si t'as kiffé. Deal, bro ? 🤝 »
- Bouton de paiement natif (§5), montant 1 €.
- Lien « Plus tard ».

**B. Champion (`champion`, 2 €)**
- Pastille « La roue a désigné {patron} » (ou rien si pas de roue).
- Gros 🏆.
- Titre : « Raté, {prénom} ! »
- Texte : « La roue t'a épargné·e… pas nous. Who is bro ? C'est gratuit, sans pub, sans pistage. 2 € si t'as kiffé. Deal, champion·ne ? »
- **Juste au-dessus du bouton**, mention manuscrite (Google Font **Caveat** 600, jaune `--accent`, rotation −4°, ~25 px) :
  « T'as gagné, alors pour toi c'est plus cher 😂 💸 »
  - Animations : la phrase « s'écrit » (glisse + fondu, 0,6 s, délai 0,3 s) ; 😂 se secoue par à-coups (boucle 1,6 s) ; 💸 = trois billets décalés (délais 0 / 0,85 / 1,7 s) qui s'envolent en courbe, tournent et disparaissent (boucle 2,6 s) ; le bouton pulse doucement en jaune.
  - `prefers-reduced-motion` : tout statique.
- Bouton de paiement natif, montant 2 €.
- Lien « Plus tard ».

**C. Les autres (`free`)**
- Pastille « La roue a désigné {patron} ».
- Gros 😮‍💨.
- Titre : « Ouf, pour toi c'était gratuit ! »
- Texte : « {patron} et {champion} font vivre Who is bro. Encourage-les ! » (adapter s'il n'y a pas de désigné ou plusieurs champions).
- Bouton jaune « Allez {patron}, régale ! 📣 » → envoie `{t:'cheer'}` à l'hôte, qui relaie au désigné : son téléphone vibre (`navigator.vibrate?.(200)`) et affiche brièvement « 📣 Inès t'encourage ! ». Anti-spam : 1 encouragement par joueur toutes les 5 s.
- Petit lien « Payer quand même 1 € » → même flux de paiement, badge 👑.

### 4.3 Après paiement réussi (téléphone du payeur)
- 1 € : « Merci {prénom} ! Nous aussi on t'aime 💛 » + badge **👑 Mécène** (cartouche doré, bord `--accent`, fond accent 10 %) qui tombe en tournant puis se pose (≈1,1 s, easing rebond) + « Ton badge te suit dans tes prochaines parties. » + pluie de 💸 depuis le bouton + bouton « Continuer ».
- 2 € : « Merci {prénom} ! Taxé·e mais classe 😂 » + badge **💎 Champion diamant** (cartouche bleu glacé `#7ad3ff`, léger scintillement en boucle) + même suite.
- « Continuer » → écran de fin.

### 4.4 Chez les autres (en direct)
- Bandeaux empilés en haut de l'écran de verdict, à l'arrivée de chaque paiement :
  - « 👑 {prénom} a régalé : badge Mécène ! » (fond jaune)
  - « 💎 {prénom} a payé sa taxe : Champion diamant ! » (fond bleu glacé)
- Chez le champion, si le désigné a payé : sous-texte « {patron} a payé sa part. À toi de jouer, champion·ne 😂 ».
- Jamais de mention de qui n'a pas payé.

### 4.5 Échec / annulation
- Annulation de la feuille Apple Pay / Google Pay : retour silencieux à l'écran de verdict.
- Erreur (réseau, carte refusée) : message court sous le bouton « Le paiement n'est pas passé. Réessaie ou passe ton tour. » ; le bouton reste actif.
- Ni Apple Pay ni Google Pay disponibles : bouton « Payer par carte » (élément carte Stripe dans une feuille), même montant.
- Stripe non chargé (hors ligne, bloqueur) : masquer le bouton, garder le texte + « Plus tard ». Ne jamais casser l'écran de fin.

---

## 5. Paiement — Stripe Express Checkout

### 5.1 Front (js/app.js ou nouveau module `js/pay.js`)
- Charger **Stripe.js** (`https://js.stripe.com/v3/`) **uniquement** à l'entrée en phase `patron` (import dynamique d'un `<script>`), jamais sur l'accueil : pas de requête vers Stripe tant qu'on ne propose pas de payer. Ajouter `js.stripe.com` au CSP s'il y en a un.
- Clé publique : constante `STRIPE_PK` dans le code (pk_test… d'abord, pk_live… au passage en réel). Elle est publique par nature.
- Utiliser l'**Express Checkout Element** (`elements.create('expressCheckout', …)`) en mode `payment`, `amount` en centimes, `currency: 'eur'`, `paymentMethods: { applePay: 'always', googlePay: 'always', link: 'never' }`, bouton thème sombre, hauteur ~46 px, `buttonType: { applePay: 'support', googlePay: 'pay' }` (ou `plain` si `support` indisponible).
- Au `confirm` : appeler le Worker (§5.2) pour obtenir un `client_secret`, puis `stripe.confirmPayment({ elements, clientSecret, redirect: 'if_required' })`.
- Succès → afficher le merci (§4.3), enregistrer le badge (§6), envoyer `{t:'paid', badge}` à l'hôte.
- Aucune donnée personnelle envoyée au Worker : seulement `{ amount: 100|200, lang }`. Pas de prénom, pas de nom de groupe, pas d'identifiant de partie.
- Libellé de relevé : « WHOISBRO » (configuré côté Stripe / Worker via `statement_descriptor_suffix`).

### 5.2 Back — Cloudflare Worker `whoisbro-pay` (nouveau dossier `worker/`)
- Une seule route `POST /intent` :
  - Valide `amount ∈ {100, 200}` (refuser tout autre montant), `currency = 'eur'`.
  - Crée un PaymentIntent via l'API Stripe (`fetch` vers `https://api.stripe.com/v1/payment_intents`, `automatic_payment_methods[enabled]=true`, `description="Soutien Who is bro"`, `statement_descriptor_suffix="WHOISBRO"`, `metadata[source]=whoisbro`).
  - Renvoie `{ clientSecret }`.
- CORS : n'autoriser que `https://whoisbro.lol` (et `http://localhost:8790`/`8792` pour le dev).
- Secret : `STRIPE_SECRET_KEY` en **secret Cloudflare** (`wrangler secret put`). **Jamais** dans le dépôt ni dans le site.
- Anti-abus léger : limite de débit par IP (Cloudflare rate limiting rule) — pas de journalisation applicative.
- Pas de webhook nécessaire pour la V1 (le badge est cosmétique, voir §6).
- Fournir `worker/wrangler.toml`, `worker/src/index.js`, et un README de déploiement (commandes `wrangler deploy`, `wrangler secret put STRIPE_SECRET_KEY`).

### 5.3 Apple Pay
- Fichier de vérification de domaine Stripe à servir à `https://whoisbro.lol/.well-known/apple-developer-merchantid-domain-association` (fourni par le dashboard Stripe une fois le domaine déclaré). GitHub Pages ignore les dossiers commençant par un point sauf si `.nojekyll` est présent → vérifier / ajouter `.nojekyll`.
- Ajouter le chemin à `serve.py` (`ALLOWED`) pour les tests locaux.

---

## 6. Badges

- Stockage : `localStorage['ctt-badge']` = `'crown'` ou `'diamond'` (le plus fort gagne : `diamond > crown`). try/catch obligatoire (navigation privée).
- Envoi : à la connexion à un salon, le client ajoute le badge au message d'arrivée (`hello` dans js/net.js l.79 → `{ t:'hello', id, name, badge }`) ; l'hôte l'attache au joueur (`p.badge`, validé : seulement `'crown' | 'diamond' | null`). L'hôte applique aussi son propre badge.
- Affichage : à droite du prénom, partout où un prénom de joueur apparaît dans les listes : salon (liste des joueurs, `playerList`), classement (`rankingScreen`), écran de fin (classement), vote si pertinent. Émoji seul, avec `title`/`aria-label` « Mécène » / « Champion diamant ».
- Un paiement pendant la partie met à jour `p.badge` immédiatement (via `{t:'paid', badge}`) → visible sur l'écran de fin de tous.
- Limites assumées (à ne pas « corriger ») : badge lié au navigateur, falsifiable, perdu si données effacées.

---

## 7. Messages réseau (nouveaux)

| Message (invité → hôte) | Effet |
|---|---|
| `{t:'paid', badge:'crown'|'diamond'}` | `p.badge = max(p.badge, badge)`, ajoute à `patron.paid`, `changed()` |
| `{t:'cheer'}` | relaie au désigné (si `phase==='patron'`), anti-spam 5 s par émetteur |
| `{t:'patron-done'}` | marque le joueur comme sorti de l'écran de verdict ; si tous sortis → `finish()` |

Valider chaque message côté hôte (phase, émetteur connu, valeurs autorisées). Un `paid` n'est qu'une déclaration du client : acceptable car cosmétique.

---

## 8. Textes (js/i18n.js, FR + EN)

| Clé | FR | EN |
|---|---|---|
| patronSpin | Qui va régaler ? | Who's buying? |
| patronSpoke | La roue a parlé | The wheel has spoken |
| patronNamed | n => `La roue a désigné ${n}` | n => `The wheel picked ${n}` |
| patronTitle | n => `C'est toi qui régales, ${n} !` | n => `You're buying, ${n}!` |
| pitch1 | Who is bro ? C'est gratuit, sans pub, sans pistage. 1 € si t'as kiffé. Deal, bro ? 🤝 | Who is bro? It's free, no ads, no tracking. 1 € if you had fun. Deal, bro? 🤝 |
| champTitle | n => `Raté, ${n} !` | n => `Nice try, ${n}!` |
| pitch2 | La roue t'a épargné·e… pas nous. Who is bro ? C'est gratuit, sans pub, sans pistage. 2 € si t'as kiffé. Deal, champion·ne ? | The wheel spared you… we won't. Who is bro? It's free, no ads, no tracking. 2 € if you had fun. Deal, champ? |
| champTax | T'as gagné, alors pour toi c'est plus cher 😂 💸 | You won, so it costs you more 😂 💸 |
| freeTitle | Ouf, pour toi c'était gratuit ! | Phew, it's free for you! |
| freeText | (p, c) => `${p} et ${c} font vivre Who is bro. Encourage-les !` | (p, c) => `${p} and ${c} keep Who is bro alive. Cheer them on!` |
| cheer | n => `Allez ${n}, régale ! 📣` | n => `Come on ${n}, pay up! 📣` |
| cheered | n => `📣 ${n} t'encourage !` | n => `📣 ${n} is cheering you on!` |
| payAnyway | Payer quand même 1 € | Chip in 1 € anyway |
| later | Plus tard | Maybe later |
| thanks1 | n => `Merci ${n} ! Nous aussi on t'aime 💛` | n => `Thanks ${n}! We love you too 💛` |
| thanks2 | n => `Merci ${n} ! Taxé·e mais classe 😂` | n => `Thanks ${n}! Taxed, but classy 😂` |
| badgeKeep | Ton badge te suit dans tes prochaines parties. | Your badge follows you to your next games. |
| badgeCrown | Mécène | Patron |
| badgeDiamond | Champion diamant | Diamond champ |
| paidCrown | n => `👑 ${n} a régalé : badge Mécène !` | n => `👑 ${n} paid up: Patron badge!` |
| paidDiamond | n => `💎 ${n} a payé sa taxe : Champion diamant !` | n => `💎 ${n} paid the tax: Diamond champ!` |
| champNudge | n => `${n} a payé sa part. À toi de jouer, champion·ne 😂` | n => `${n} paid their share. Your turn, champ 😂` |
| payFailed | Le paiement n'est pas passé. Réessaie ou passe ton tour. | The payment didn't go through. Try again or skip. |
| payCard | Payer par carte | Pay by card |
| continue | Continuer | Continue |

Le jeu ne connaît pas le genre des joueurs : garder les formes neutres (« épargné·e », « champion·ne », « Taxé·e »).

---

## 9. Pages légales à mettre à jour

- `confidentialite.html` / `privacy.html` : nouvelle section « Si tu soutiens le jeu » :
  - paiement traité par Stripe (lien vers sa politique), encaissé par Cambon AI ;
  - nous ne recevons ni ta carte, ni ton nom, ni ton e-mail ; Stripe.js n'est chargé que sur l'écran de soutien ;
  - le badge est enregistré uniquement sur ton téléphone (`ctt-badge`).
- `qui-sommes-nous.html` / `about.html` : mentions de l'encaisseur (Cambon AI, raison sociale, SIREN, adresse — **à fournir par Stéphane**, laisser des placeholders `[SIREN]`, `[ADRESSE]` clairement marqués).
- Mettre à jour la date « Dernière mise à jour ».

---

## 10. Paramètres et constantes

```js
export const PATRON_SPIN_MS = 4500;
export const PATRON_MAX_MS = 60000;
export const PATRON_MIN_PLAYERS = 3;   // en dessous : pas de roue (2) ou pas de phase (1)
const AMOUNTS = { patron: 100, champion: 200, free: 100 };   // centimes
const BADGE_RANK = { crown: 1, diamond: 2 };
```

Option dans les réglages de l'hôte ? **Non** pour la V1 (toujours actif). Prévoir un drapeau global `SUPPORT_ENABLED` (true) pour couper la fonctionnalité d'un coup si besoin.

---

## 11. Tests

- `tools/test-game.mjs` : tirage pipé (500 tirages) — jamais un champion, jamais un déconnecté, ex æquo tous protégés, `eligible` vide → pas de roue ; `patronDone` empêche une 2ᵉ phase après « Rejouer » ; snapshot/restore en phase `patron`.
- `tools/test-devices.mjs` : scénarios existants à adapter (la fin passe désormais par `patron`) ; vérifier sur chaque appareil : 3 rôles affichés correctement, « Plus tard » mène à l'écran de fin, pas de débordement horizontal, pas d'erreur JS. Stripe **mocké** dans les tests (intercepter `js.stripe.com` et le Worker ; simuler succès, annulation, échec).
- Test manuel en **mode test Stripe** sur un vrai iPhone (Apple Pay, carte de test Stripe) et un vrai Android (Google Pay) avant tout passage en `pk_live`.
- Vérifier qu'**aucune** requête vers Stripe ou le Worker ne part depuis l'accueil, le salon ou pendant les manches.

---

## 12. Hors périmètre (V1)

- Webhooks Stripe, reçus, factures.
- Badge vérifiable / signé.
- Paliers de badges (👑👑…).
- « J'offre la tournée », bonus à débloquer, cagnotte collective.
- Toute forme de publicité.

---

## 13. Prérequis côté produit (bloquants pour la mise en ligne, pas pour le développement)

1. Compte Stripe au nom de Cambon AI, Apple Pay activé, domaine whoisbro.lol déclaré → fichier de vérification.
2. Clés **test** (`pk_test…`, `sk_test…`) puis **live**.
3. Compte Cloudflare (Cambon AI) pour le Worker.
4. Mentions légales Cambon AI (SIREN, adresse).
5. Dépôt passé en privé (GitHub Pro sur Raf1607) avant d'y ajouter quoi que ce soit lié au paiement.

Développement possible dès maintenant avec un **mode simulé** : si `STRIPE_PK` est vide, le bouton de paiement affiche « Payer (simulation) » et déclenche directement le succès — **uniquement** quand `location.hostname` est `localhost` ; en prod sans clé, la phase `patron` est désactivée (`SUPPORT_ENABLED = false`).
