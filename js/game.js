// La partie, telle que la tient le téléphone de l'hôte. Tout l'état vit ici ; chaque
// téléphone reçoit seulement ce qu'il doit afficher (jamais la réponse avant la révélation).

import { pickRecords } from './records.js';
import { TUNING as T } from './tuning.js';
import { score } from './scoring.js';
import { DICT } from './i18n.js';
import { SUPPORT_ENABLED } from './support.js';
import { BAR, PREP_BARS, SHORT_BARS, LONG_BARS, LONG_MIN_PHOTOS, TAIL } from './music.js';

export const ROUNDS = [10, 15, 20];
export const SECONDS = [15, 25, 40];
const GAIN = 2, LOSS = 1;   // points par bonne et par mauvaise réponse (jamais en dessous de zéro)
const AFTER_FIRST_VOTE = 7000;   // dès le premier vote, il ne reste que ce temps aux autres
const ALL_VOTED_PAUSE = 600;     // tout le monde a voté : petite pause avant la réponse
// Roue de la fortune : une chance sur trois après chaque manche (sauf la dernière). Huit cases, autant
// de chances chacune. Les bonus doublent des points (le dernier, le premier qui trouve, un joueur au
// hasard, tout le monde), protègent ou ajoutent une manche ; les malus visent le premier du classement.
// Les cases de même nature sont séparées sur la roue.
export const WHEEL = [
  { id: 'pouce', kind: 'bonus' },       // le dernier du classement marque double à la manche suivante
  { id: 'moins2', kind: 'malus' },      // le premier perd 2 points tout de suite
  { id: 'course', kind: 'bonus' },      // le premier à trouver la bonne réponse marque double
  { id: 'roulette', kind: 'bonus' },    // un joueur au hasard marque double
  { id: 'flou', kind: 'malus' },        // le premier a la question floue jusqu'au premier vote
  { id: 'manche', kind: 'bonus' },      // tout compte double pour tous : gains et pertes
  { id: 'bouclier', kind: 'bonus' },    // un joueur au hasard est protégé du prochain malus
  { id: 'extra', kind: 'bonus' },       // une manche de plus que prévu (une fois par partie)
];
export const RANDOM_PICK = ['roulette', 'bouclier'];   // cases suivies du défilé des prénoms
export const WHEEL_SPIN_MS = 4000;   // la roue tourne, puis le résultat reste affiché le temps de le lire
export const WHEEL_MS = 10000;
export const ROULETTE_MS = 4000;     // en plus, pour le défilé des prénoms
const WHEEL_CHANCE = 1 / 3;

// Vrai hasard du navigateur, pas Math.random.
const randomInt = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
// Grand groupe : au plus 6 réponses proposées par manche. Les leurres sont tirés parmi les membres
// actifs (au moins 2 % des messages du groupe), d'autant plus souvent qu'ils écrivent beaucoup.
export const MAX_CHOICES = 6;
const ACTIVE_SHARE = 0.02;
const chance = p => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 < p;

// Soutien en fin de partie : une roue (pipée) désigne un joueur invité à payer 1 €, le champion est
// invité à payer 2 €, les autres jouent gratuitement. Jamais un champion, jamais un absent ; rien ne se
// gagne en payant (la roue désigne seulement qui est invité à payer). Une seule fois par salon.
export const PATRON_SPIN_MS = 4500;
export const PATRON_MAX_MS = 60000;
export const PATRON_MIN_PLAYERS = 2;
export const AMOUNTS = { patron: 100, champion: 200, free: 100 };   // centimes
const CHEER_EVERY = 5000;                                       // un encouragement par joueur toutes les 5 s
const BADGE_RANK = { crown: 1, diamond: 2 };
export const badgeOf = b => (BADGE_RANK[b] ? b : null);
const bestBadge = (a, b) => ((BADGE_RANK[b] || 0) > (BADGE_RANK[a] || 0) ? b : a || null);


// Fin de partie en musique : « Sounds on » (3 mesures, la musique démarre déjà), puis le montage photo sur la
// suite du même morceau, 20 s en tout (moins de 10 photos) ou 30 s. La musique part au même instant sur tous
// les téléphones : l'hôte fixe l'heure de départ (son horloge, performance.now()) un peu à l'avance.
const MONTAGE_MIN_ITEMS = 3;
export const MUSIC_LEAD = 1500;               // ms entre l'annonce et le départ de la musique
const hostNow = () => performance.now();
// Répartition des 6 pistes entre les téléphones connectés (hôte d'abord, puis ordre d'arrivée).
// Au-delà de 6, les suivants doublent la mélodie, les percus, les accords, la mélodie…
const PLAN = {
  1: [['all']],
  2: [['kick', 'bass', 'perc'], ['chords', 'lead', 'fx']],
  3: [['kick', 'perc'], ['bass', 'chords'], ['lead', 'fx']],
  4: [['kick', 'perc'], ['bass'], ['chords'], ['lead', 'fx']],
  5: [['kick'], ['perc'], ['bass'], ['chords'], ['lead', 'fx']],
  6: [['kick'], ['perc'], ['bass'], ['chords'], ['lead'], ['fx']],
};
const EXTRA = ['lead', 'perc', 'chords'];
export const stemPlan = n => (n <= 6 ? PLAN[Math.max(1, n)].map(x => x.slice()) : [...PLAN[6].map(x => x.slice()), ...Array.from({ length: n - 6 }, (_, i) => [EXTRA[i % 3]])]);
const RHYTHMIC = ['kick', 'perc', 'bass'];
const POOR_SYNC = 80;                          // ms : un téléphone mal calé prend une piste peu rythmique
const RANKING_MS = 3000;         // durée de l'écran de classement entre deux manches

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const ticId = (owner, t) => owner + '|' + (t.id || t.file || t.text);
// Catégories de questions : messages (« qui a écrit ça ? » et cultes), titres (records, habitudes,
// emoji préféré : les superlatifs), photos, tics (expressions, emojis, stickers et GIF fétiches…).
const CATEGORIES = ['message', 'titre', 'photo', 'tic'];
export const categoryOf = kind => (kind === 'message' || kind === 'culte' ? 'message'
  : kind === 'record' || kind === 'favori' || kind === 'habitude' ? 'titre' : kind === 'photo' ? 'photo' : 'tic');

// Toutes les questions possibles, par catégorie, chacune avec son score commun q (0 à 1, js/scoring.js)
// et un petit tirage au sort j (pour que deux parties ne se ressemblent pas). Celles déjà jouées lors des
// parties précédentes sont écartées, sauf s'il ne reste rien d'autre.
function candidates({ members, cults, records, used, photoText }) {
  const fresh = list => { const f = list.filter(c => !used.has(ticId(c.owner, c.tic))); return f.length ? f : list; };
  const names = new Set(members.map(m => m.name));
  const out = { message: [], titre: [], photo: [], tic: [] };
  const react = (n, k) => 1 - Math.exp(-n / k);

  // Messages cultes (ceux qui ont le plus fait réagir) et « qui a écrit ça ? ».
  out.message.push(...fresh(cults.filter(c => names.has(c.author)).map(c => ({ owner: c.author,
    q: score(T.fun.culte, 0.8, react(c.reactions || 3, 4), 1),
    tic: { kind: 'culte', id: 'culte:' + c.text, text: c.text, detail: c.detail, uses: 0, others: 0 } }))));
  const quoted = new Set(cults.map(c => c.text));
  out.message.push(...fresh(members.flatMap(m => m.tics.filter(t => t.kind === 'message' && !quoted.has(t.text))
    .map(t => ({ owner: m.name, q: t.quality ?? 0.4, tic: t })))));

  // Titres, habitudes et emoji préféré : déjà notés (records.js, tics.js).
  out.titre.push(...fresh(records.map(c => ({ owner: c.owner, q: c.score ?? 0.4, tic: c.tic }))));
  out.titre.push(...fresh(members.flatMap(m => m.tics.filter(t => t.kind === 'habitude').map(t => ({ owner: m.name, q: t.quality ?? 0.4, tic: t })))));

  // Photos : d'autant mieux qu'elles ont fait réagir.
  if (photoText) {
    out.photo = fresh(members.flatMap(m => (m.photos || []).map(p => (typeof p === 'string' ? { file: p, score: 0 } : p))
      .map(p => ({ owner: m.name, day: p.day,
        q: score(T.fun.photo, 1, T.photoFloor + (1 - T.photoFloor) * react(p.score, 6) + ((p.burst || 1) <= 1 ? T.photoAlone : 0), 1),
        tic: { kind: 'photo', text: photoText, file: p.file, uses: m.photoCount || m.photos.length, others: 0, topOther: null, example: null } }))));
  }

  // Tics de langage, stickers et GIF fétiches (jamais la ponctuation).
  out.tic = fresh(members.flatMap(m => m.tics.filter(t => !['message', 'habitude', 'ponct'].includes(t.kind))
    .map(t => ({ owner: m.name, q: t.quality ?? 0.3, tic: t }))));
  for (const list of Object.values(out)) for (const c of list) c.j = 1 + T.jitter * (2 * Math.random() - 1);
  return out;
}

// Composition de la partie : rounds manches, plus une carte de réserve pour la « Question bonus ».
//  1. Planchers : chaque catégorie prend ses meilleures questions jusqu'à son plancher (TUNING.bounds).
//  2. Manches libres : aux meilleures questions restantes, toutes catégories confondues, sans dépasser
//     les plafonds. Un groupe aux photos très commentées aura plus de photos, un groupe sans tics nets
//     plus de messages et de titres.
//  Partout : les joueurs présents d'abord, une personne au plus dans 25 % des manches, une question
//  sous TUNING.minScore seulement s'il ne reste rien, jamais deux fois la même tournure.
//  3. Chaque joueur présent est la réponse d'au moins une manche s'il a de quoi.
//  4. Ordre : jamais deux fois de suite la même personne, les catégories alternent, et la première
//     question porte sur un joueur présent.
export function buildDeck({ members, cults = [], records = [], present, rounds, used, photos = false, photoText = 'photo' }) {
  const pool = candidates({ members, cults, records, used, photoText: photos ? photoText : null });
  const base = T.bounds[rounds] || T.bounds[10];
  const bounds = photos && pool.photo.length ? base : { ...base, photo: [0, 0] };
  const chosen = [], count = new Map(), kinds = new Map(), inCat = new Map();
  const n = name => count.get(name) || 0;
  const people = new Set(Object.values(pool).flat().map(c => c.owner)).size;
  const personCap = Math.max(Math.ceil(T.personShare * rounds), Math.ceil(rounds / Math.max(1, people)));
  const perTen = Math.ceil(rounds / 10);
  const perOwner = { message: T.messagesPerPerson, titre: perTen, photo: perTen, tic: 2 };
  // Plafonds par sorte : cultes, habitudes et emojis préférés limités ; débuts et fins de message : un en tout.
  const kindKey = kind => (kind === 'fin' ? 'debut' : kind);
  const kindCap = kind => (kind === 'culte' ? T.cults[rounds] || 1 : kind === 'habitude' || kind === 'favori' ? perTen
    : kind === 'debut' || kind === 'fin' ? T.edgeMax : kind === 'record' || kind === 'message' || kind === 'photo' ? Infinity
      : Math.max(2, Math.ceil(bounds.tic[1] / 2)));
  const value = c => c.q * c.j * (present.has(c.owner) ? T.presentBoost : 1) / (1 + n(c.owner)) ** T.ownerPenalty;
  // Une même tournure ne sert pas deux fois : ni en question de tic et dans un « qui a écrit ça ? »,
  // ni dans deux messages de la même personne (la deuxième fois, tout le monde a compris).
  const flat = s => ` ${String(s || '').toLowerCase().replace(/[^\p{L}\p{N}'\p{Extended_Pictographic}]+/gu, ' ')} `;
  const spoils = (c, cat) => {
    if (cat === 'tic' && ['expr', 'mot', 'debut', 'fin', 'emoji'].includes(c.tic.kind)) {
      const t = flat(c.tic.text);
      return chosen.some(x => x.cat === 'message' && x.owner === c.owner && flat(x.tic.text).includes(t));
    }
    if (cat === 'message') {
      const seen = new Set([...chosen.filter(x => x.owner === c.owner && x.cat === 'tic').map(x => flat(x.tic.text)),
        ...chosen.filter(x => x.owner === c.owner && x.cat === 'message').flatMap(x => (x.tic.found || []).map(flat))]);
      return (c.tic.found || []).some(f => [...seen].some(u => u.includes(flat(f)) || flat(f).includes(u)));
    }
    return false;
  };
  // Niveaux d'exigence : 0 tout, 1 sans le score minimal, 2 sans les plafonds par catégorie et par sorte,
  // 3 sans le plafond par personne (dernier recours pour remplir la partie).
  const allowed = (c, cat, lvl) => {
    if (lvl < 1 && c.q < T.minScore) return false;
    if (lvl < 2 && chosen.filter(x => x.cat === cat && x.owner === c.owner).length >= perOwner[cat]) return false;
    if (lvl < 2 && (kinds.get(kindKey(c.tic.kind)) || 0) >= kindCap(c.tic.kind)) return false;
    if (lvl < 2 && spoils(c, cat)) return false;
    // Pas deux photos du même jour : ce serait deux fois la même soirée.
    if (lvl < 2 && cat === 'photo' && c.day != null && chosen.some(x => x.cat === 'photo' && x.day === c.day)) return false;
    if (lvl < 3 && n(c.owner) >= personCap) return false;
    return true;
  };
  const add = (c, cat) => {
    pool[cat].splice(pool[cat].indexOf(c), 1);
    chosen.push({ owner: c.owner, tic: c.tic, q: c.q, cat, day: c.day });
    count.set(c.owner, n(c.owner) + 1);
    inCat.set(cat, (inCat.get(cat) || 0) + 1);
    kinds.set(kindKey(c.tic.kind), (kinds.get(kindKey(c.tic.kind)) || 0) + 1);
  };
  const best = (cats, lvl) => {
    let top = null;
    for (const cat of cats) for (const c of pool[cat]) {
      if (!allowed(c, cat, lvl)) continue;
      const v = value(c);
      if (!top || v > top.v) top = { c, cat, v };
    }
    if (top) add(top.c, top.cat);
    return !!top;
  };

  // 1. Planchers, en commençant par le message culte (le plus drôle de la discussion), s'il y en a un.
  const cult = pool.message.filter(c => c.tic.kind === 'culte' && allowed(c, 'message', 1)).sort((x, y) => y.q * y.j - x.q * x.j)[0];
  if (cult) add(cult, 'message');
  for (const cat of CATEGORIES) for (const lvl of [0, 1]) while ((inCat.get(cat) || 0) < bounds[cat][0] && best([cat], lvl));
  // 2. Manches libres : la meilleure question restante, dans une catégorie qui n'a pas atteint son plafond.
  for (const lvl of [0, 1, 2, 3]) {
    while (chosen.length < rounds) {
      const open = lvl < 2 ? CATEGORIES.filter(cat => (inCat.get(cat) || 0) < bounds[cat][1]) : CATEGORIES;
      if (!best(open, lvl)) break;
    }
  }

  // 3. Chaque joueur présent a sa question, s'il a de quoi.
  for (const name of shuffle([...present])) {
    if (n(name)) continue;
    for (const cat of ['tic', 'photo', 'message', 'titre']) {
      const mine = pool[cat].filter(c => c.owner === name).sort((x, y) => y.q - x.q)[0];
      const victims = chosen.filter(c => c.cat === cat && (!present.has(c.owner) || n(c.owner) >= 2))
        .sort((x, y) => (present.has(x.owner) - present.has(y.owner)) || x.q - y.q);
      if (!mine || !victims.length) continue;
      const v = victims[0];
      chosen.splice(chosen.indexOf(v), 1);
      count.set(v.owner, n(v.owner) - 1);
      inCat.set(cat, inCat.get(cat) - 1);
      kinds.set(kindKey(v.tic.kind), kinds.get(kindKey(v.tic.kind)) - 1);
      add(mine, cat);
      break;
    }
  }

  // 4. Ordre : plusieurs essais au hasard, on garde le meilleur.
  let order = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    const deck = arrange(chosen, present);
    const cost = deck.reduce((sum, c, i) => sum + (i && c.owner === deck[i - 1].owner ? 100 : 0) + (i && c.cat === deck[i - 1].cat ? 1 : 0), 0)
      + (present.size && !present.has(deck[0]?.owner) ? 10 : 0);
    if (!order || cost < order.cost) order = { deck, cost };
    if (cost === 0) break;
  }
  const deck = order?.deck || [];
  // Carte de réserve : la meilleure question restante, d'une autre personne que la dernière manche.
  const last = deck[deck.length - 1]?.owner;
  let spare = null;
  for (const cat of CATEGORIES) for (const c of pool[cat]) {
    if (c.owner === last || (spare && value(c) <= value(spare.c))) continue;
    spare = { c, cat };
  }
  if (spare) deck.push({ owner: spare.c.owner, tic: spare.c.tic, cat: spare.cat });
  return deck.map(({ owner, tic }) => ({ owner, tic }));
}

// Un essai d'ordre : au hasard, en évitant la même personne et la même catégorie deux fois de suite,
// avec un joueur présent pour commencer.
function arrange(cards, present) {
  const pool = shuffle(cards.slice());
  const deck = [];
  while (pool.length) {
    const prev = deck[deck.length - 1];
    const tests = deck.length ? [c => c.owner !== prev.owner && c.cat !== prev.cat, c => c.owner !== prev.owner]
      : [c => present.has(c.owner) && c.cat !== 'photo', c => present.has(c.owner)];
    let j = -1;
    for (const t of tests) if ((j = pool.findIndex(t)) >= 0) break;
    deck.push(pool.splice(Math.max(0, j), 1)[0]);
  }
  return deck;
}

// Image ou vidéo à montrer pour un tic (sticker, GIF, photo) ; id = nom du fichier dans l'export.
export function mediaOf(tic) {
  if (!tic.file) return null;
  return { id: tic.file, type: /\.(mp4|mov|3gp)$/i.test(tic.file) ? 'video' : 'image' };
}

export class Game {
  constructor(analysis, code, hostId, onChange) {
    this.analysis = analysis;
    this.lang = DICT[analysis.lang] ? analysis.lang : 'fr';   // la langue de l'hôte, pour toute la partie
    this.code = code;
    this.hostId = hostId;
    this.players = new Map();       // id → { id, author, name, outside, score, connected, order }
    this.settings = { rounds: 10, seconds: 25, absent: true, photos: true, slideshow: true, wheel: true };   // tout coché par défaut
    this.phase = 'lobby';
    this.used = new Set();
    this.deck = [];
    this.options = [];
    this.round = null;
    this.order = [];      // classement à la fin de la manche précédente (ids)
    this.wheelChance = WHEEL_CHANCE;
    this.pending = {};    // effets de la roue pour la prochaine manche : effet → id du joueur
    this.shields = new Set();
    this.wheel = null;
    this.records = [];
    this.timer = null;
    this.allowed = new Set();       // téléphones acceptés par l'hôte
    this.waiting = new Map();       // id → { id, name, at } : en attente de l'hôte
    this.refused = new Set();
    this.support = SUPPORT_ENABLED;   // soutien en fin de partie (coupé sans clé Stripe)
    this.patron = null;               // phase « patron » : roue du mécène et paiements
    this.patronDone = false;          // déjà proposé dans ce salon : pas deux fois (« Rejouer » le même soir)
    this.music = null;                // musique de fin : version, heure de départ, pistes de chacun
    this.syncQuality = {};            // id → { rtt, jitter } : qualité du calage d'horloge de chaque invité
    this.join(hostId);
    this.onChange = onChange;
  }

  member(name) { return this.analysis.authors.find(a => a.name === name); }

  // Un téléphone qui se connecte n'entre pas tout seul : l'hôte l'accepte d'abord (sinon
  // n'importe qui ayant le code recevrait les noms et les messages du groupe). Un joueur déjà
  // accepté revient directement ; une fois la partie lancée, plus personne de nouveau n'entre.
  // Renvoie 'ok', 'wait', 'refused' ou 'closed'.
  request(id, name, badge = null) {
    if (this.allowed.has(id)) { this.join(id, badge); return 'ok'; }
    if (this.refused.has(id)) return 'refused';
    if (this.phase !== 'lobby') return 'closed';
    if (!this.waiting.has(id)) this.waiting.set(id, { id, name: String(name || '').trim().slice(0, 24), at: Date.now(), badge: badgeOf(badge) });
    this.changed();
    return 'wait';
  }

  // L'hôte tranche ; onAdmit prévient l'app (envoi de l'état, ou refus et fermeture).
  admit(id, ok) {
    if (!this.waiting.has(id)) return;
    if (ok) this.join(id);             // join() retire la demande et garde le prénom tapé
    else { this.waiting.delete(id); this.refused.add(id); this.onAdmit?.(id, 'refused'); this.changed(); }
  }

  // badge : 'crown' (mécène) ou 'diamond' (champion diamant), gardé sur le téléphone du joueur.
  join(id, badge) {
    this.allowed.add(id);
    const name = this.waiting.get(id)?.name || '';
    badge = badgeOf(badge) || this.waiting.get(id)?.badge || null;
    this.waiting.delete(id);
    const p = this.players.get(id);
    if (p) { p.connected = true; p.badge = bestBadge(p.badge, badge); }
    else this.players.set(id, { id, author: null, name, outside: false, score: 0, connected: true, order: this.players.size, badge });
    this.changed();
  }

  // Badge du téléphone de l'hôte (il ne passe pas par request).
  setBadge(id, badge) {
    const p = this.players.get(id);
    if (p && badgeOf(badge)) { p.badge = bestBadge(p.badge, badge); this.changed(); }
  }

  leave(id) {
    if (this.waiting.delete(id)) return this.changed();
    const p = this.players.get(id);
    if (!p) return;
    this.handOver(id);
    if (this.phase === 'lobby' && !p.author && !p.outside) this.players.delete(id);
    else p.connected = false;
    this.checkVotes();
    this.changed();
  }

  handle(id, msg) {
    const p = this.players.get(id);
    if (!p || !msg) return;
    const host = id === this.hostId;
    if (msg.t === 'claim' && this.phase === 'lobby' && this.member(msg.author)) {
      const owner = [...this.players.values()].find(q => q.author === msg.author);
      if (!owner || !owner.connected) {
        if (owner) owner.author = null;
        p.author = msg.author;
        p.outside = false;
      }
    } else if (msg.t === 'outside' && this.phase === 'lobby') {
      // Pas dans la discussion : on joue quand même, sous son prénom, sans jamais être une réponse.
      const name = String(msg.name || '').trim().slice(0, 24);
      if (name) Object.assign(p, { author: null, outside: true, name });
    } else if (msg.t === 'vote' && this.phase === 'question' && msg.n === this.round.n
               && (this.round.options || this.options).includes(msg.author)) {      // on peut changer d'avis jusqu'à la fin
      this.round.votes[id] = msg.author;
      (this.round.at ??= {})[id] = Date.now();   // l'heure du dernier vote, pour la course au ×2
      this.checkVotes();
    } else if (msg.t === 'settings' && host && this.phase === 'lobby') {
      const s = msg.settings || {};
      if (ROUNDS.includes(s.rounds)) this.settings.rounds = s.rounds;
      if (SECONDS.includes(s.seconds)) this.settings.seconds = s.seconds;
      if (typeof s.absent === 'boolean') this.settings.absent = s.absent;
      if (typeof s.photos === 'boolean') this.settings.photos = s.photos;
      if (typeof s.slideshow === 'boolean') this.settings.slideshow = s.slideshow;
      if (typeof s.wheel === 'boolean') this.settings.wheel = s.wheel;
    } else if (msg.t === 'admit' && host && typeof msg.id === 'string') {
      return this.admit(msg.id, !!msg.ok);
    } else if (msg.t === 'start' && host && this.phase === 'lobby') {
      if (this.canStart().ok) {
        for (const id of [...this.waiting.keys()]) { this.waiting.delete(id); this.onAdmit?.(id, 'closed'); }
        return this.start();
      }
    } else if (msg.t === 'next' && host && this.phase === 'reveal') {
      return this.next();
    } else if (msg.t === 'sync-quality' && Number.isFinite(msg.rtt) && Number.isFinite(msg.jitter)) {
      this.syncQuality[id] = { rtt: msg.rtt, jitter: msg.jitter };
      return;
    } else if (msg.t === 'skip' && host && (this.phase === 'montage' || this.phase === 'soundson')) {
      return this.wrapUp();
    } else if (msg.t === 'skip' && host && this.phase === 'patron') {
      return this.finish();
    } else if (msg.t === 'paid' && this.patron && (this.phase === 'patron' || this.phase === 'end') && badgeOf(msg.badge)) {
      // Une simple déclaration du téléphone : c'est cosmétique (un badge), on ne vérifie pas plus.
      p.badge = bestBadge(p.badge, msg.badge);
      if (!this.patron.paid.some(x => x.id === id)) this.patron.paid.push({ id, badge: msg.badge });
      else this.patron.paid.find(x => x.id === id).badge = bestBadge(this.patron.paid.find(x => x.id === id).badge, msg.badge);
    } else if (msg.t === 'cheer' && this.phase === 'patron' && this.patron.step === 'verdict' && this.patron.patronId && id !== this.patron.patronId) {
      const now = Date.now();
      if (now - (this.patron.cheered[id] || 0) < CHEER_EVERY) return;
      this.patron.cheered[id] = now;
      this.patron.cheer = { from: p.author || p.name || '', seq: (this.patron.cheer?.seq || 0) + 1 };
    } else if (msg.t === 'patron-done' && this.phase === 'patron') {
      if (!this.patron.done.includes(id)) this.patron.done.push(id);
      const waiting = [...this.players.values()].filter(q => q.connected && (q.author || q.outside || q.id === this.hostId) && !this.patron.done.includes(q.id));
      if (!waiting.length) return this.finish();
    } else if (msg.t === 'replay' && host && (this.phase === 'end' || this.phase === 'patron')) {
      clearTimeout(this.timer);
      this.phase = 'lobby';
    }
    this.changed();
  }

  // Les noms proposés au vote : les joueurs, plus (en option) les membres absents de la partie.
  // Si les joueurs ne sont presque pas dans la discussion, les absents sont toujours de la partie.
  candidates() {
    const players = [...this.players.values()];
    const names = new Set(players.map(p => p.author).filter(Boolean));
    const owners = [...names].filter(n => this.member(n).tics.length).length;
    const outsiders = players.some(p => p.outside && p.connected);
    if (this.settings.absent || (outsiders && owners < 2)) for (const a of this.analysis.authors) if (a.tics.length) names.add(a.name);
    return [...names].sort((a, b) => a.localeCompare(b, 'fr'));
  }

  canStart() {
    const present = [...this.players.values()].filter(p => p.connected);
    if (present.some(p => !p.author && !p.outside)) return { ok: false, reason: 'needClaim' };
    const owners = this.candidates().filter(n => this.member(n).tics.length);
    if (owners.length < 2) return { ok: false, reason: 'needTwo' };
    return { ok: true };
  }

  start() {
    this.options = this.candidates();
    const present = new Set([...this.players.values()].filter(p => p.connected).map(p => p.author).filter(n => this.options.includes(n)));
    const rounds = this.settings.rounds;
    // Titres (« qui répond le plus vite ? »…), sans redire un emoji déjà dans les tics de son propriétaire.
    this.records = pickRecords(this.options.map(name => ({ name, stats: this.member(name).stats })), this.analysis.authors, this.lang)
      .filter(c => c.tic.kind !== 'favori' || !this.member(c.owner).tics.some(t => t.text === c.tic.text));
    this.deck = buildDeck({
      members: this.options.map(n => this.member(n)), cults: this.analysis.cults || [], records: this.records,
      present, rounds, used: this.used, photos: this.settings.photos, photoText: DICT[this.lang].thisPhoto,
    });
    this.spare = this.deck.length > rounds ? this.deck.pop() : null;
    for (const p of this.players.values()) p.score = 0;
    this.index = 0;
    this.order = [];
    this.pending = {};
    this.shields = new Set();
    this.ask();
  }

  ask() {
    const card = this.deck[this.index];
    this.used.add(ticId(card.owner, card.tic));
    const ms = this.settings.seconds * 1000;
    const effects = this.pending;
    this.pending = {};
    this.round = { n: this.index + 1, card, votes: {}, at: {}, endsAt: Date.now() + ms, effects, options: this.choicesFor(card.owner) };
    this.phase = 'question';
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.reveal(), ms + 300);
    this.changed();
  }

  // Réponses proposées : la bonne, puis les joueurs présents, puis des leurres actifs tirés au hasard
  // (pondéré par le nombre de messages). Les membres trop peu actifs ne servent jamais de leurre.
  choicesFor(owner) {
    if (this.options.length <= MAX_CHOICES) return this.options;
    const present = shuffle([...new Set([...this.players.values()].map(p => p.author))]
      .filter(n => n && n !== owner && this.options.includes(n)));
    const picked = [owner, ...present].slice(0, MAX_CHOICES);
    const total = this.analysis.authors.reduce((sum, a) => sum + a.messages, 0);
    const others = this.options.filter(n => !picked.includes(n))
      .map(name => ({ name, weight: this.member(name).messages }))
      .sort((a, b) => b.weight - a.weight);
    const missing = MAX_CHOICES - picked.length;
    const active = others.filter(o => o.weight >= total * ACTIVE_SHARE);
    const pool = active.length >= missing ? active : others.slice(0, missing);   // sinon, les plus actifs qui restent
    while (picked.length < MAX_CHOICES && pool.length) {
      let r = Math.random() * pool.reduce((sum, o) => sum + o.weight, 0);
      const i = Math.max(0, pool.findIndex(o => (r -= o.weight) < 0));
      picked.push(pool.splice(i, 1)[0].name);
    }
    return picked.sort((a, b) => a.localeCompare(b, 'fr'));
  }

  // Premier vote : il ne reste que 7 secondes aux autres. Tout le monde a voté : la manche se termine.
  checkVotes() {
    if (this.phase !== 'question') return;
    const present = [...this.players.values()].filter(p => p.connected);
    if (present.length && present.every(p => this.round.votes[p.id])) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.reveal(), ALL_VOTED_PAUSE);
    } else if (Object.keys(this.round.votes).length && this.round.endsAt - Date.now() > AFTER_FIRST_VOTE) {
      this.round.endsAt = Date.now() + AFTER_FIRST_VOTE;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.reveal(), AFTER_FIRST_VOTE + 300);
    }
  }

  reveal() {
    if (this.phase !== 'question') return;
    clearTimeout(this.timer);
    this.round.deltas = {};
    const fx = this.round.effects, owner = this.round.card.owner, at = this.round.at || {};
    // Course au ×2 : le premier à avoir voté pour la bonne réponse (l'heure de son dernier vote).
    const right = Object.keys(this.round.votes).filter(id => this.round.votes[id] === owner);
    this.round.racer = fx.course ? right.sort((a, b) => (at[a] ?? 0) - (at[b] ?? 0))[0] || null : null;
    for (const [id, author] of Object.entries(this.round.votes)) {
      const p = this.players.get(id);
      if (!p) continue;
      const doubled = fx.all || fx.double?.id === id || this.round.racer === id;
      const gain = doubled ? GAIN * 2 : GAIN, loss = fx.all ? LOSS * 2 : LOSS;
      const score = author === owner ? p.score + gain : Math.max(0, p.score - loss);
      this.round.deltas[id] = score - p.score;
      p.score = score;
    }
    this.phase = 'reveal';
    this.changed();
  }

  // Après la réponse : le classement animé pendant 3 secondes, puis la suite toute seule.
  next() {
    const place = id => { const i = this.order.indexOf(id); return i < 0 ? this.order.length : i; };
    const shown = [...this.players.values()].filter(p => p.author || p.outside || this.round.votes[p.id]);
    const after = shown.sort((a, b) => b.score - a.score || place(a.id) - place(b.id)).map(p => p.id);
    this.ranking = { before: this.order.length ? this.order : after, after, deltas: this.round.deltas || {} };
    this.order = after;
    this.phase = 'ranking';
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.advance(), RANKING_MS);
    this.changed();
  }

  // Après le classement : la roue si le sort le veut, puis la manche suivante.
  advance() {
    if (this.phase === 'ranking' && this.settings.wheel && this.index + 1 < this.deck.length && chance(this.wheelChance)) return this.spin();
    if (this.phase !== 'ranking' && this.phase !== 'wheel') return;
    clearTimeout(this.timer);
    this.index++;
    if (this.index < this.deck.length) return this.ask();
    if (this.montageItems().length < MONTAGE_MIN_ITEMS) return this.wrapUp();
    this.soundsOn();
  }

  // « Sounds on » : version du morceau selon le nombre de photos du montage, départ programmé, pistes de chacun.
  soundsOn() {
    clearTimeout(this.timer);
    const photos = this.montageItems().filter(m => m.kind === 'photo').length;
    const version = photos >= LONG_MIN_PHOTOS ? 'long' : 'short';
    const bars = version === 'long' ? LONG_BARS : SHORT_BARS;
    const startAt = hostNow() + MUSIC_LEAD;
    this.music = { version, bars, startAt, assign: this.assignStems(), from: {} };
    this.phase = 'soundson';
    this.timer = setTimeout(() => this.toMontage(), startAt + PREP_BARS * BAR * 1000 - hostNow());
    this.changed();
  }

  // Le montage commence pile au début de la mesure 4, la musique continue sans coupure.
  toMontage() {
    if (this.phase !== 'soundson') return;
    this.phase = 'montage';
    const { startAt, bars } = this.music;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.wrapUp(), startAt + (bars * BAR + TAIL) * 1000 - hostNow());
    this.changed();
  }

  // Pistes de chaque téléphone connecté. Un téléphone mal calé (trajet minimal > 80 ms) échange ses pistes
  // rythmiques (kick, percus, basse) contre celles d'un téléphone bien calé qui joue accords ou effets.
  assignStems() {
    const phones = [...this.players.values()].filter(p => p.connected)
      .sort((a, b) => (b.id === this.hostId) - (a.id === this.hostId) || a.order - b.order).map(p => p.id);
    const plan = stemPlan(phones.length);
    const assign = Object.fromEntries(phones.map((id, i) => [id, plan[i]]));
    const poor = id => (this.syncQuality[id]?.rtt ?? 0) > POOR_SYNC;
    for (const id of phones) {
      if (!poor(id) || !assign[id].some(k => RHYTHMIC.includes(k))) continue;
      const mate = phones.find(o => !poor(o) && assign[o].every(k => !RHYTHMIC.includes(k)));
      if (mate) [assign[id], assign[mate]] = [assign[mate], assign[id]];
    }
    return assign;
  }

  // Un téléphone part pendant la musique : ses pistes passent à celui qui en a le moins, à la mesure suivante.
  handOver(id) {
    const m = this.music;
    if (!m || (this.phase !== 'soundson' && this.phase !== 'montage') || !m.assign[id]) return;
    const stems = m.assign[id];
    delete m.assign[id];
    const others = Object.keys(m.assign).filter(o => this.players.get(o)?.connected && o !== id);
    if (!others.length) return;
    const to = others.sort((a, b) => m.assign[a].length - m.assign[b].length)[0];
    m.assign[to] = m.assign[to].includes('all') ? ['all'] : [...new Set([...m.assign[to], ...stems])];
    if (stems.includes('all') || m.assign[to].length >= 6) m.assign[to] = ['all'];
    m.from[to] = Math.max(0, Math.floor((hostNow() - m.startAt) / (BAR * 1000)) + 1);
  }

  // Après le montage (ou la dernière manche) : la roue du mécène si le soutien est actif, une seule fois
  // par salon et à deux joueurs classés au moins ; sinon directement l'écran de fin.
  wrapUp() {
    const ranked = [...this.players.values()].filter(p => p.author || p.outside);
    if (!this.support || this.patronDone || ranked.length < PATRON_MIN_PLAYERS) return this.finish();
    return this.startPatron(ranked);
  }

  // Tirage pipé : jamais un champion (ex æquo : tous champions), jamais un joueur déconnecté. La roue porte
  // tous les prénoms (champions compris, pour le suspense), frôle un champion et s'arrête sur le désigné.
  startPatron(ranked) {
    clearTimeout(this.timer);
    ranked = ranked.slice().sort((a, b) => a.order - b.order);
    const top = Math.max(...ranked.map(p => p.score));
    const champions = ranked.filter(p => p.score === top).map(p => p.id);
    const eligible = ranked.filter(p => p.score !== top && p.connected);
    const patronId = eligible.length ? eligible[randomInt(eligible.length)].id : null;
    const stopIndex = patronId ? ranked.findIndex(p => p.id === patronId) : null;
    let angle = null;
    if (patronId) {
      // Angle final, tiré par l'hôte pour que tous les téléphones voient la même chose. La roue tourne
      // dans le sens des aiguilles d'une montre : juste avant de s'arrêter, le pointeur passe sur la case
      // suivante ; si c'est un champion, on s'arrête tout près de la frontière (il l'a frôlé).
      const slice = 360 / ranked.length;
      const next = ranked[(stopIndex + 1) % ranked.length];
      const jitter = champions.includes(next.id) && ranked.length > 1 ? -0.38 * slice : (randomInt(1000) / 1000 - 0.5) * 0.6 * slice;
      angle = 360 * 6 - (stopIndex + 0.5) * slice + jitter;
    }
    this.patron = {
      step: patronId ? 'spin' : 'verdict', ids: ranked.map(p => p.id), names: ranked.map(p => p.author || p.name || ''),
      stopIndex, angle, patronId, champions, paid: [], done: [], cheer: null, cheered: {},
    };
    this.patronDone = true;
    this.phase = 'patron';
    if (patronId) this.timer = setTimeout(() => this.verdict(), PATRON_SPIN_MS);
    else this.timer = setTimeout(() => this.finish(), PATRON_MAX_MS);
    this.changed();
  }

  verdict() {
    if (this.phase !== 'patron') return;
    this.patron.step = 'verdict';
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finish(), PATRON_MAX_MS);
    this.changed();
  }

  finish() {
    clearTimeout(this.timer);
    this.phase = 'end';
    this.changed();
  }

  // Messages du montage : les cultes d'abord, puis les plus typiques de chacun.
  montageQuotes() {
    const typical = shuffle(this.analysis.authors.flatMap(a => a.tics.filter(t => t.kind === 'message').map(t => ({ author: a.name, text: t.text }))));
    return [...(this.analysis.cults || []), ...typical].slice(0, 8).map(({ author, text }) => ({ author, text }));
  }

  // Médias du montage de fin (export avec médias, si l'hôte a laissé l'option activée).
  montageItems() {
    return this.settings.slideshow ? this.analysis.montage || [] : [];
  }

  spin() {
    const shields = this.shields;          // un bouclier vaut jusqu'au tour de roue suivant
    this.shields = new Set();
    const cases = WHEEL.map((_, i) => i).filter(i => WHEEL[i].id !== 'extra' || this.spare);
    const index = cases[randomInt(cases.length)], seg = WHEEL[index];
    const players = [...this.players.values()].filter(p => p.connected && (p.author || p.outside));
    const pick = list => (list.length ? list[randomInt(list.length)].id : null);
    const scores = players.map(p => p.score);
    let target = null;
    if (seg.id === 'pouce') target = pick(players.filter(p => p.score === Math.min(...scores)));
    else if (RANDOM_PICK.includes(seg.id)) target = pick(players);
    else if (seg.kind === 'malus') target = pick(players.filter(p => p.score === Math.max(...scores)));
    const shielded = seg.kind === 'malus' && shields.has(target);
    if (shielded) { /* le malus ne passe pas */ }
    else if (seg.id === 'pouce' || seg.id === 'roulette') this.pending.double = { id: target, why: seg.id };
    else if (seg.id === 'course') this.pending.course = true;
    else if (seg.id === 'manche') this.pending.all = true;
    else if (seg.id === 'bouclier') this.shields.add(target);
    else if (seg.id === 'extra') { this.deck.push({ ...this.spare, bonus: true }); this.spare = null; }
    else if (seg.id === 'moins2') { const p = this.players.get(target); if (p) p.score = Math.max(0, p.score - 2); }
    else if (seg.id === 'flou') this.pending.flou = target;
    const random = RANDOM_PICK.includes(seg.id);
    this.wheel = { index, target, shielded, names: random ? players.map(p => p.author || p.name) : null };
    this.phase = 'wheel';
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.advance(), WHEEL_MS + (random ? ROULETTE_MS : 0));
    this.changed();
  }

  changed() { this.onChange?.(); }

  // Instantané de la partie (données simples), gardé sur le téléphone de l'hôte pour reprendre après
  // un rechargement de la page.
  snapshot() {
    const { code, hostId, settings, phase, deck, options, round, order, pending, wheel, records, index, ranking, spare, patron, patronDone, music } = this;
    return {
      code, hostId, settings, phase, deck, options, round, order, pending, wheel, records, index, ranking, spare, patron, patronDone, music,
      used: [...this.used], shields: [...this.shields], allowed: [...this.allowed], refused: [...this.refused],
      players: [...this.players.values()],
    };
  }

  // Reprise : les invités sont considérés déconnectés jusqu'à ce qu'ils reviennent (ils sont déjà
  // acceptés, ils rentrent directement), et les minuteurs repartent en leur laissant le temps.
  static restore(analysis, snap) {
    const g = new Game(analysis, snap.code, snap.hostId, null);
    for (const k of ['settings', 'phase', 'deck', 'options', 'round', 'order', 'pending', 'wheel', 'records', 'index', 'ranking', 'spare', 'patron', 'music']) g[k] = snap[k];
    g.patronDone = !!snap.patronDone;
    if (g.round) g.round.card = g.deck[g.index] || g.round.card;
    g.used = new Set(snap.used);
    g.shields = new Set(snap.shields);
    g.allowed = new Set(snap.allowed);
    g.refused = new Set(snap.refused);
    g.players = new Map(snap.players.map(p => [p.id, { ...p, connected: p.id === snap.hostId }]));
    const RESUME_GRACE = 15000;
    if (g.phase === 'question') {
      g.round.endsAt = Math.max(g.round.endsAt, Date.now() + RESUME_GRACE);
      g.timer = setTimeout(() => g.reveal(), g.round.endsAt - Date.now() + 300);
    } else if (g.phase === 'ranking' || g.phase === 'wheel') g.timer = setTimeout(() => g.advance(), 2000);
    // L'heure de l'hôte repart de zéro avec la page : la musique ne peut pas reprendre, on passe à la suite.
    else if (g.phase === 'montage' || g.phase === 'soundson') g.timer = setTimeout(() => g.wrapUp(), 2000);
    else if (g.phase === 'patron' && g.patron?.step === 'spin') g.timer = setTimeout(() => g.verdict(), 2000);
    else if (g.phase === 'patron') g.timer = setTimeout(() => g.finish(), PATRON_MAX_MS);
    return g;
  }

  // Diaporama de fin : les photos les plus commentées du groupe, si l'hôte l'a laissé activé.
  slides() {
    if (!this.settings.slideshow) return [];
    return (this.analysis.slideshow || []).map(p => ({ id: p.file, author: p.author, emojis: p.emojis }));
  }

  // Ce que voit le joueur `id`.
  view(id) {
    const players = [...this.players.values()].sort((a, b) => a.order - b.order).map(p => ({
      id: p.id, author: p.author, name: p.name, outside: !!p.outside, score: p.score, connected: p.connected, host: p.id === this.hostId, badge: p.badge || null,
      voted: this.phase === 'question' && !!this.round.votes[p.id],
    }));
    const v = { phase: this.phase, lang: this.lang, code: this.code, title: this.analysis.title, withMedia: !!this.analysis.withMedia, me: id, host: id === this.hostId, players, settings: this.settings };

    if (this.phase === 'lobby') {
      v.members = this.analysis.authors.map(a => ({ name: a.name, messages: a.messages, tics: a.tics.length }));
      v.absentCount = this.analysis.authors.filter(a => a.tics.length && !players.some(p => p.author === a.name)).length;
      v.photoCount = this.analysis.authors.reduce((n, a) => n + (a.photos?.length || 0), 0);
      v.slideCount = this.analysis.slideshow?.length || 0;
      v.canStart = this.canStart();
      if (id === this.hostId) v.waiting = [...this.waiting.values()].map(({ id: wid, name }) => ({ id: wid, name }));
    }
    if (this.phase === 'question' || this.phase === 'reveal') {
      const { n, card, votes, endsAt } = this.round;
      v.round = { n, total: this.deck.length, text: card.tic.text, kind: card.tic.kind, of: card.tic.of || null, media: mediaOf(card.tic), options: this.round.options || this.options, bonus: !!card.bonus };
      if (this.phase === 'reveal' && card.tic.detail) v.round.detail = card.tic.detail;
      if (this.phase === 'question') {
        Object.assign(v.round, { remaining: Math.max(0, endsAt - Date.now()), seconds: this.settings.seconds, myVote: votes[id] || null });
        const fx = this.round.effects;
        v.round.blurred = fx.flou === id && !Object.keys(votes).length;
        if (fx.flou === id) v.round.flou = true;
        if (fx.double?.id === id) v.round.boost = fx.double.why;      // 'pouce' ou 'roulette'
        if (fx.course) v.round.course = true;
        if (fx.all) v.round.all = true;
      } else {
        const { uses, others, topOther, example } = card.tic;
        Object.assign(v.round, { answer: card.owner, ownerMessages: this.member(card.owner).messages, uses, others, topOther, example, votes, deltas: this.round.deltas, last: n === this.deck.length });
        if (this.round.effects.course) v.round.racer = this.round.racer || '';   // '' : personne n'a trouvé
      }
    }
    if (this.phase === 'ranking') {
      const { before, after, deltas } = this.ranking;
      v.ranking = {
        n: this.round.n, total: this.deck.length,
        rows: after.map(pid => {
          const p = this.players.get(pid);
          return { id: pid, name: p.author || p.name || '', badge: p.badge || null, shield: this.shields.has(pid), score: p.score, delta: deltas[pid] || 0, was: Math.max(0, before.indexOf(pid)) };
        }),
      };
    }
    if (this.phase === 'soundson' || this.phase === 'montage') {
      const m = this.music, mine = m.assign[id] || [];
      v.music = { version: m.version, bars: m.bars, prepBars: PREP_BARS, startAt: m.startAt, mine: mine.includes('all') ? [] : mine, solo: mine.includes('all'), from: m.from[id] || 0 };
      // Les photos dans l'ordre du score (la meilleure d'abord), puis stickers et GIF.
      v.montage = {
        items: this.montageItems().map(x => ({ ...mediaOf(x), kind: x.kind })),
        quotes: this.montageQuotes(),
      };
    }
    if (this.phase === 'wheel') {
      const p = this.players.get(this.wheel.target);
      v.wheel = { index: this.wheel.index, shielded: this.wheel.shielded, target: p?.author || p?.name || '', mine: this.wheel.target === id, names: this.wheel.names };
    }
    if (this.phase === 'patron') {
      const P = this.patron, nameOf = pid => { const q = this.players.get(pid); return q?.author || q?.name || ''; };
      const role = P.champions.includes(id) ? 'champion' : id === P.patronId ? 'patron' : 'free';
      v.patron = {
        step: P.step, names: P.names, stopIndex: P.stopIndex, angle: P.angle,
        patron: P.patronId ? nameOf(P.patronId) : null, champions: P.champions.map(nameOf),
        role, amount: AMOUNTS[role],
        paid: P.paid.map(x => ({ name: nameOf(x.id), badge: x.badge, role: P.champions.includes(x.id) ? 'champion' : x.id === P.patronId ? 'patron' : 'free' })),
        cheer: id === P.patronId ? P.cheer : null,
      };
    }
    // L'écran de fin se prépare dès la roue du mécène : chacun y passe quand il veut.
    if (this.phase === 'end' || this.phase === 'patron') {
      v.slides = this.slides();
      const L = DICT[this.lang];
      v.portraits = this.options.map(name => ({
        name,
        tics: [
          ...this.records.filter(c => c.owner === name && c.tic.kind === 'record').map(c => c.tic.text),
          ...this.member(name).tics.filter(t => !t.file && t.kind !== 'message').slice(0, 4).map(t => (t.kind === 'habitude' ? L.portraitHabit(t.text) : t.kind === 'debut' ? L.start_(t.text) : t.kind === 'fin' ? L.end_(t.text) : t.text)),
        ],
      }));
    }
    return v;
  }
}
