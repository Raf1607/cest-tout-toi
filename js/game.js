// La partie, telle que la tient le téléphone de l'hôte. Tout l'état vit ici ; chaque
// téléphone reçoit seulement ce qu'il doit afficher (jamais la réponse avant la révélation).

import { pickRecords } from './records.js';
import { DICT } from './i18n.js';

export const ROUNDS = [6, 10, 15, 20];
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

export const MONTAGE_MS = 15000;   // montage de fin, avant le classement final
const MONTAGE_MIN_ITEMS = 3;
const RANKING_MS = 3000;         // durée de l'écran de classement entre deux manches

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const ticId = (owner, t) => owner + '|' + (t.id || t.file || t.text);
const FAMILY = { expr: 'mots', mot: 'mots', ponct: 'mots', debut: 'mots', fin: 'mots', emoji: 'emoji', sticker: 'media', gif: 'media', habitude: 'habitude', message: 'message' };

// Pour varier les questions, on alterne les familles de tics de chacun (mots, emoji, sticker/GIF,
// habitude), en prenant à chaque fois le meilleur restant de la famille.
function varied(tics) {
  const families = new Map();
  for (const t of tics) {
    const f = FAMILY[t.kind] || 'mots';
    if (!families.has(f)) families.set(f, []);
    families.get(f).push(t);
  }
  const out = [];
  while (families.size) {
    for (const [f, list] of families) {
      out.push(list.shift());
      if (!list.length) families.delete(f);
    }
  }
  return out;
}

// File de questions d'un membre : ses tics en alternant les familles (le meilleur restant de chacune),
// les cinq premiers mélangés pour varier d'une partie à l'autre, son sticker ou GIF fétiche tôt.
// Ceux déjà joués lors des parties précédentes sont écartés (sauf s'il ne reste rien d'autre).
function queueOf(a, used) {
  const fresh = a.tics.filter(t => !used.has(ticId(a.name, t)));
  let list = varied(fresh.length ? fresh : a.tics.slice());
  list = [...shuffle(list.slice(0, 5)), ...shuffle(list.slice(5))];
  const fav = list.findIndex(t => t.kind === 'sticker' || t.kind === 'gif');
  if (fav > 2) list.splice(2, 0, list.splice(fav, 1)[0]);
  return list;
}

// Composition de la partie (rounds manches, plus une carte de réserve pour la « Question bonus ») :
//  1. Des manches réservées, réparties dans la partie : le message culte, les titres (environ une
//     manche sur trois en tout) et, avec l'option photos, les photos qui ont le plus fait réagir.
//  2. Les autres manches portent sur les tics. Chaque joueur présent est la réponse d'au moins une
//     manche (s'il a des tics et qu'il y a assez de manches), et les joueurs présents ont environ deux
//     manches sur trois quand on joue aussi sur les absents. Sinon, chacun à son tour.
//  3. Pas trop de questions du même type, et jamais deux fois de suite la même personne.
// specials : cartes réservées { owner, tic } ; present : noms des joueurs présents.
export function buildDeck({ owners, specials, present, rounds, used }) {
  const total = rounds + 1;
  specials = specials.slice(0, rounds);
  const queues = new Map(owners.map(a => [a.name, queueOf(a, used)]));
  const count = new Map(owners.map(a => [a.name, 0]));
  for (const c of specials) if (count.has(c.owner)) count.set(c.owner, count.get(c.owner) + 1);

  // Plafonds par type : au plus deux « qui a écrit ça ? » sur dix manches, un quart des manches pour les autres.
  const kinds = new Map();
  const cap = kind => (kind === 'message' ? Math.max(1, Math.round(rounds / 5)) : Math.max(2, Math.ceil(rounds / 4)));
  const take = name => {
    const q = queues.get(name);
    let i = q.findIndex(t => (kinds.get(t.kind) || 0) < cap(t.kind));
    if (i < 0) i = 0;
    const tic = q.splice(i, 1)[0];
    kinds.set(tic.kind, (kinds.get(tic.kind) || 0) + 1);
    count.set(name, count.get(name) + 1);
    return { owner: name, tic };
  };
  // Le membre qui a le moins de manches jusqu'ici (au hasard à égalité).
  const next = names => {
    const open = shuffle(names.filter(n => queues.get(n).length));
    if (!open.length) return null;
    return open.reduce((best, n) => (count.get(n) < count.get(best) ? n : best));
  };

  const here = owners.map(a => a.name).filter(n => present.has(n));
  const away = owners.map(a => a.name).filter(n => !present.has(n));
  const wanted = total - specials.length;
  // Part des joueurs présents : deux manches sur trois, au moins une chacun si possible.
  const hereShare = away.length ? Math.min(wanted, Math.max(Math.round(wanted * 2 / 3), here.length)) : wanted;
  const normal = [];
  while (normal.length < wanted) {
    const herePicked = normal.filter(c => present.has(c.owner)).length;
    const fromHere = herePicked < hereShare;
    const name = next(fromHere ? here : away) || next(fromHere ? away : here);
    if (!name) break;
    normal.push(take(name));
  }

  // Carte de réserve : celle d'un membre qui a déjà d'autres manches (un absent de préférence), pour
  // qu'aucun joueur ne perde sa seule question si la roue ne tombe pas sur « Question bonus ».
  let spare = null;
  if (specials.length + normal.length > rounds) {
    const weight = c => count.get(c.owner) * 2 + (present.has(c.owner) ? 0 : 1) + Math.random();
    const i = normal.reduce((bi, c, k) => (weight(c) > weight(normal[bi]) ? k : bi), 0);
    spare = normal.splice(i, 1)[0];
  }
  // Ordre : plusieurs essais au hasard, on garde le premier sans deux fois de suite la même personne.
  let best = null;
  for (let attempt = 0; attempt < 80; attempt++) {
    const deck = arrange(specials, normal, rounds, present);
    if (spare) deck.push(spare);
    const repeats = deck.filter((c, i) => i && c.owner === deck[i - 1].owner).length;
    if (!best || repeats < best.repeats) best = { deck, repeats };
    if (!repeats) break;
  }
  return best.deck;
}

// Un essai d'ordre : les manches réservées réparties régulièrement (jamais en premier), les autres au
// hasard, une question sur un joueur présent pour commencer.
function arrange(specials, normal, rounds, present) {
  const length = specials.length + normal.length;
  const played = Math.min(rounds, length);
  const slots = new Map();
  shuffle(specials.slice()).forEach((c, i) => {
    let at = Math.floor(((i + 0.5 + (Math.random() - 0.5) * 0.6) * played) / specials.length);
    at = Math.min(played - 1, Math.max(played > 1 ? 1 : 0, at));
    while (slots.has(at)) at = (at + 1) % played;
    slots.set(at, c);
  });
  const pool = shuffle(normal.slice());
  const deck = [];
  for (let i = 0; i < length && (slots.has(i) || pool.length); i++) {
    if (slots.has(i)) { deck.push(slots.get(i)); continue; }
    const prev = deck[i - 1]?.owner, after = slots.get(i + 1)?.owner;
    let j = i === 0 ? pool.findIndex(c => present.has(c.owner) && c.owner !== after) : -1;
    if (j < 0) j = pool.findIndex(c => c.owner !== prev && c.owner !== after);
    if (j < 0) j = pool.findIndex(c => c.owner !== prev);
    deck.push(pool.splice(Math.max(0, j), 1)[0]);
  }
  return deck;
}

// Photos à mettre en question : la plus commentée de chacun, puis les meilleures du groupe, en
// variant les personnes. Une photo sans aucune réaction ne passe qu'à défaut.
function pickPhotos(members, used, max, text) {
  const best = members.map(a => (a.photos || [])
    .map(p => (typeof p === 'string' ? { file: p, score: 0 } : p))
    .filter(p => !used.has(a.name + '|' + p.file))
    .map(p => ({ owner: a.name, score: p.score + Math.random() * 0.5, tic: { kind: 'photo', text, file: p.file, uses: a.photoCount || a.photos.length, others: 0, topOther: null, example: null } })));
  const firsts = shuffle(best.filter(l => l.length).map(l => l.shift())).sort((x, y) => y.score - x.score);
  const rest = best.flat().sort((x, y) => y.score - x.score);
  return [...firsts, ...rest].slice(0, max).map(({ owner, tic }) => ({ owner, tic }));
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
    this.join(hostId);
    this.onChange = onChange;
  }

  member(name) { return this.analysis.authors.find(a => a.name === name); }

  // Un téléphone qui se connecte n'entre pas tout seul : l'hôte l'accepte d'abord (sinon
  // n'importe qui ayant le code recevrait les noms et les messages du groupe). Un joueur déjà
  // accepté revient directement ; une fois la partie lancée, plus personne de nouveau n'entre.
  // Renvoie 'ok', 'wait', 'refused' ou 'closed'.
  request(id, name) {
    if (this.allowed.has(id)) { this.join(id); return 'ok'; }
    if (this.refused.has(id)) return 'refused';
    if (this.phase !== 'lobby') return 'closed';
    if (!this.waiting.has(id)) this.waiting.set(id, { id, name: String(name || '').trim().slice(0, 24), at: Date.now() });
    this.changed();
    return 'wait';
  }

  // L'hôte tranche ; onAdmit prévient l'app (envoi de l'état, ou refus et fermeture).
  admit(id, ok) {
    if (!this.waiting.has(id)) return;
    if (ok) this.join(id);             // join() retire la demande et garde le prénom tapé
    else { this.waiting.delete(id); this.refused.add(id); this.onAdmit?.(id, 'refused'); this.changed(); }
  }

  join(id) {
    this.allowed.add(id);
    const name = this.waiting.get(id)?.name || '';
    this.waiting.delete(id);
    const p = this.players.get(id);
    if (p) p.connected = true;
    else this.players.set(id, { id, author: null, name, outside: false, score: 0, connected: true, order: this.players.size });
    this.changed();
  }

  leave(id) {
    if (this.waiting.delete(id)) return this.changed();
    const p = this.players.get(id);
    if (!p) return;
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
    } else if (msg.t === 'skip' && host && this.phase === 'montage') {
      return this.finish();
    } else if (msg.t === 'replay' && host && this.phase === 'end') {
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
    const owners = this.options.map(n => this.member(n)).filter(a => a.tics.length);
    const present = new Set([...this.players.values()].filter(p => p.connected).map(p => p.author).filter(n => this.options.includes(n)));
    const rounds = this.settings.rounds;
    // Manches réservées : le message culte (celui qui a le plus fait réagir) et les titres, environ une
    // manche sur trois en tout ; les vrais records avant les emojis préférés, ceux des joueurs présents
    // d'abord, sans redire un emoji déjà dans les tics de son propriétaire.
    this.records = pickRecords(this.options.map(name => ({ name, stats: this.member(name).stats })), this.analysis.authors, this.lang)
      .filter(c => c.tic.kind !== 'favori' || !this.member(c.owner).tics.some(t => t.text === c.tic.text));
    const fresh = this.records.filter(c => !this.used.has(ticId(c.owner, c.tic)));
    const pool = fresh.length ? fresh : this.records.slice();
    const rank = c => (c.tic.kind === 'record' ? 0 : 2) + (present.has(c.owner) ? 0 : 1);
    const titles = shuffle(pool.slice()).sort((x, y) => rank(x) - rank(y));
    const specials = [];
    const cult = (this.analysis.cults || []).find(c => this.options.includes(c.author) && !this.used.has(c.author + '|culte:' + c.text));
    if (cult) specials.push({ owner: cult.author, tic: { kind: 'culte', id: 'culte:' + cult.text, text: cult.text, detail: cult.detail, uses: 0, others: 0 } });
    // Pas plus d'un titre par personne sur dix manches, pour varier les gagnants.
    const perOwner = new Map(), maxTitles = Math.max(1, Math.round(rounds / 3)) - specials.length;
    for (const c of titles) {
      if (specials.length - (cult ? 1 : 0) >= maxTitles) break;
      if ((perOwner.get(c.owner) || 0) >= Math.ceil(rounds / 10)) continue;
      perOwner.set(c.owner, (perOwner.get(c.owner) || 0) + 1);
      specials.push(c);
    }
    // Photos (option) : environ une manche sur cinq, les plus commentées.
    if (this.settings.photos) {
      specials.push(...pickPhotos(this.options.map(n => this.member(n)), this.used, Math.max(1, Math.round(rounds / 5)), DICT[this.lang].thisPhoto));
    }
    this.deck = buildDeck({ owners, specials, present, rounds, used: this.used });
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
    if (this.montageItems().length < MONTAGE_MIN_ITEMS) return this.finish();
    this.phase = 'montage';
    this.timer = setTimeout(() => this.finish(), MONTAGE_MS);
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
    const { code, hostId, settings, phase, deck, options, round, order, pending, wheel, records, index, ranking, spare } = this;
    return {
      code, hostId, settings, phase, deck, options, round, order, pending, wheel, records, index, ranking, spare,
      used: [...this.used], shields: [...this.shields], allowed: [...this.allowed], refused: [...this.refused],
      players: [...this.players.values()],
    };
  }

  // Reprise : les invités sont considérés déconnectés jusqu'à ce qu'ils reviennent (ils sont déjà
  // acceptés, ils rentrent directement), et les minuteurs repartent en leur laissant le temps.
  static restore(analysis, snap) {
    const g = new Game(analysis, snap.code, snap.hostId, null);
    for (const k of ['settings', 'phase', 'deck', 'options', 'round', 'order', 'pending', 'wheel', 'records', 'index', 'ranking', 'spare']) g[k] = snap[k];
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
    else if (g.phase === 'montage') g.timer = setTimeout(() => g.finish(), MONTAGE_MS);
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
      id: p.id, author: p.author, name: p.name, outside: !!p.outside, score: p.score, connected: p.connected, host: p.id === this.hostId,
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
          return { id: pid, name: p.author || p.name || '', shield: this.shields.has(pid), score: p.score, delta: deltas[pid] || 0, was: Math.max(0, before.indexOf(pid)) };
        }),
      };
    }
    if (this.phase === 'montage') {
      v.montage = {
        items: this.montageItems().map(m => ({ ...mediaOf(m), kind: m.kind })),
        quotes: this.montageQuotes(),
      };
    }
    if (this.phase === 'wheel') {
      const p = this.players.get(this.wheel.target);
      v.wheel = { index: this.wheel.index, shielded: this.wheel.shielded, target: p?.author || p?.name || '', mine: this.wheel.target === id, names: this.wheel.names };
    }
    if (this.phase === 'end') {
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
