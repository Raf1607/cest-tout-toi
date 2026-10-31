// La partie, telle que la tient le téléphone de l'hôte. Tout l'état vit ici ; chaque
// téléphone reçoit seulement ce qu'il doit afficher (jamais la réponse avant la révélation).

import { pickRecords } from './records.js';

export const ROUNDS = [6, 10, 15, 20];
export const SECONDS = [15, 25, 40];
const GAIN = 2, LOSS = 1;   // points par bonne et par mauvaise réponse (jamais en dessous de zéro)
const AFTER_FIRST_VOTE = 7000;   // dès le premier vote, il ne reste que ce temps aux autres
const ALL_VOTED_PAUSE = 600;     // tout le monde a voté : petite pause avant la réponse
const RANKING_MS = 5000;         // durée de l'écran de classement entre deux manches

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

// Les manches tournent entre les membres (chacun autant que possible, jamais deux fois de suite),
// en piochant d'abord dans leurs meilleurs tics, et en évitant ceux déjà joués lors des parties précédentes.
// Avec l'option photos, chacun a aussi une ou deux questions « qui a envoyé cette photo ? ».
// extra : nom → records gagnés, glissés tôt dans la file de leur gagnant.
function buildDeck(owners, total, used, withPhotos, extra) {
  const queues = owners.map(a => {
    const fresh = a.tics.filter(t => !used.has(ticId(a.name, t)));
    let list = varied(fresh.length ? fresh : a.tics.slice());
    list = [...shuffle(list.slice(0, 5)), ...shuffle(list.slice(5))];   // un tic de chaque famille en tête
    (extra.get(a.name) || []).forEach((tic, i) => list.splice(1 + 2 * i, 0, tic));
    // Son sticker ou GIF fétiche passe tôt : les titres ne doivent pas le repousser hors de la partie.
    const fav = list.findIndex(t => t.kind === 'sticker' || t.kind === 'gif');
    if (fav > 2) list.splice(2, 0, list.splice(fav, 1)[0]);
    if (withPhotos && a.photos?.length) {
      const photos = shuffle(a.photos.filter(f => !used.has(a.name + '|' + f)).slice());
      const card = file => ({ kind: 'photo', text: 'cette photo', file, uses: a.photoCount || a.photos.length, others: 0, topOther: null, example: null });
      if (photos[0]) list.splice(1 + Math.floor(Math.random() * 3), 0, card(photos[0]));
      if (photos[1]) list.splice(6 + Math.floor(Math.random() * 3), 0, card(photos[1]));
    }
    return { owner: a.name, list };
  });
  const deck = [];
  let last = null;
  while (deck.length < total) {
    const cycle = shuffle(queues.filter(q => q.list.length));
    if (!cycle.length) break;
    if (cycle.length > 1 && cycle[0].owner === last) cycle.push(cycle.shift());
    for (const q of cycle) {
      if (deck.length >= total) break;
      deck.push({ owner: q.owner, tic: q.list.shift() });
      last = q.owner;
    }
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
    this.code = code;
    this.hostId = hostId;
    this.players = new Map();       // id → { id, author, score, connected, order }
    this.settings = { rounds: 10, seconds: 25, absent: false, photos: false, slideshow: true };
    this.phase = 'lobby';
    this.used = new Set();
    this.deck = [];
    this.options = [];
    this.round = null;
    this.order = [];      // classement à la fin de la manche précédente (ids)
    this.records = [];
    this.timer = null;
    this.join(hostId);
    this.onChange = onChange;
  }

  member(name) { return this.analysis.authors.find(a => a.name === name); }

  join(id) {
    const p = this.players.get(id);
    if (p) p.connected = true;
    else this.players.set(id, { id, author: null, score: 0, connected: true, order: this.players.size });
    this.changed();
  }

  leave(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.phase === 'lobby' && !p.author) this.players.delete(id);
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
      }
    } else if (msg.t === 'vote' && this.phase === 'question' && msg.n === this.round.n
               && this.options.includes(msg.author)) {      // on peut changer d'avis jusqu'à la fin
      this.round.votes[id] = msg.author;
      this.checkVotes();
    } else if (msg.t === 'settings' && host && this.phase === 'lobby') {
      const s = msg.settings || {};
      if (ROUNDS.includes(s.rounds)) this.settings.rounds = s.rounds;
      if (SECONDS.includes(s.seconds)) this.settings.seconds = s.seconds;
      if (typeof s.absent === 'boolean') this.settings.absent = s.absent;
      if (typeof s.photos === 'boolean') this.settings.photos = s.photos;
      if (typeof s.slideshow === 'boolean') this.settings.slideshow = s.slideshow;
    } else if (msg.t === 'start' && host && this.phase === 'lobby') {
      if (this.canStart().ok) return this.start();
    } else if (msg.t === 'next' && host && this.phase === 'reveal') {
      return this.next();
    } else if (msg.t === 'replay' && host && this.phase === 'end') {
      this.phase = 'lobby';
    }
    this.changed();
  }

  // Les noms proposés au vote : les joueurs, plus (en option) les membres absents de la partie.
  candidates() {
    const names = new Set([...this.players.values()].map(p => p.author).filter(Boolean));
    if (this.settings.absent) for (const a of this.analysis.authors) if (a.tics.length) names.add(a.name);
    return [...names].sort((a, b) => a.localeCompare(b, 'fr'));
  }

  canStart() {
    const present = [...this.players.values()].filter(p => p.connected);
    if (present.some(p => !p.author)) return { ok: false, reason: 'Chaque joueur doit choisir qui il est dans la discussion.' };
    const owners = this.candidates().filter(n => this.member(n).tics.length);
    if (owners.length < 2) return { ok: false, reason: 'Il faut au moins deux joueurs (ou inclure les membres absents).' };
    return { ok: true };
  }

  start() {
    this.options = this.candidates();
    const owners = this.options.map(n => this.member(n)).filter(a => a.tics.length);
    // Records (« qui répond le plus vite ? »…) : environ une manche sur trois, les vrais records avant
    // les emojis préférés, et sans redire un emoji déjà dans les tics de son propriétaire.
    this.records = pickRecords(this.options.map(name => ({ name, stats: this.member(name).stats })), this.analysis.authors)
      .filter(c => c.tic.kind !== 'favori' || !this.member(c.owner).tics.some(t => t.text === c.tic.text));
    const fresh = this.records.filter(c => !this.used.has(ticId(c.owner, c.tic)));
    const pool = fresh.length ? fresh : this.records.slice();
    const chosen = [...shuffle(pool.filter(c => c.tic.kind === 'record')), ...shuffle(pool.filter(c => c.tic.kind !== 'record'))]
      .slice(0, Math.max(1, Math.round(this.settings.rounds / 3)));
    // Et un message culte (celui qui a fait le plus réagir), si son auteur est dans la partie.
    const cult = (this.analysis.cults || []).find(c => this.options.includes(c.author) && !this.used.has(c.author + '|culte:' + c.text));
    if (cult) chosen.push({ owner: cult.author, tic: { kind: 'culte', id: 'culte:' + cult.text, text: cult.text, detail: cult.detail, uses: 0, others: 0 } });
    const extra = new Map();
    for (const c of chosen) extra.set(c.owner, [...(extra.get(c.owner) || []), c.tic]);
    const deckOwners = [...owners, ...[...extra.keys()].filter(n => !owners.some(a => a.name === n)).map(n => ({ ...this.member(n), tics: [] }))];
    this.deck = buildDeck(deckOwners, this.settings.rounds, this.used, this.settings.photos, extra);
    for (const p of this.players.values()) p.score = 0;
    this.index = 0;
    this.order = [];
    this.ask();
  }

  ask() {
    const card = this.deck[this.index];
    this.used.add(ticId(card.owner, card.tic));
    const ms = this.settings.seconds * 1000;
    this.round = { n: this.index + 1, card, votes: {}, endsAt: Date.now() + ms };
    this.phase = 'question';
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.reveal(), ms + 300);
    this.changed();
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
    for (const [id, author] of Object.entries(this.round.votes)) {
      const p = this.players.get(id);
      if (!p) continue;
      const score = author === this.round.card.owner ? p.score + GAIN : Math.max(0, p.score - LOSS);
      this.round.deltas[id] = score - p.score;
      p.score = score;
    }
    this.phase = 'reveal';
    this.changed();
  }

  // Après la réponse : le classement animé pendant 5 secondes, puis la suite toute seule.
  next() {
    const place = id => { const i = this.order.indexOf(id); return i < 0 ? this.order.length : i; };
    const shown = [...this.players.values()].filter(p => p.author || this.round.votes[p.id]);
    const after = shown.sort((a, b) => b.score - a.score || place(a.id) - place(b.id)).map(p => p.id);
    this.ranking = { before: this.order.length ? this.order : after, after, deltas: this.round.deltas || {} };
    this.order = after;
    this.phase = 'ranking';
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.advance(), RANKING_MS);
    this.changed();
  }

  advance() {
    if (this.phase !== 'ranking') return;
    clearTimeout(this.timer);
    this.index++;
    if (this.index < this.deck.length) return this.ask();
    this.phase = 'end';
    this.changed();
  }

  changed() { this.onChange?.(); }

  // Diaporama de fin : les photos les plus commentées du groupe, si l'hôte l'a laissé activé.
  slides() {
    if (!this.settings.slideshow) return [];
    return (this.analysis.slideshow || []).map(p => ({ id: p.file, author: p.author, emojis: p.emojis }));
  }

  // Ce que voit le joueur `id`.
  view(id) {
    const players = [...this.players.values()].sort((a, b) => a.order - b.order).map(p => ({
      id: p.id, author: p.author, score: p.score, connected: p.connected, host: p.id === this.hostId,
      voted: this.phase === 'question' && !!this.round.votes[p.id],
    }));
    const v = { phase: this.phase, code: this.code, title: this.analysis.title, me: id, host: id === this.hostId, players, settings: this.settings };

    if (this.phase === 'lobby') {
      v.members = this.analysis.authors.map(a => ({ name: a.name, messages: a.messages, tics: a.tics.length }));
      v.absentCount = this.analysis.authors.filter(a => a.tics.length && !players.some(p => p.author === a.name)).length;
      v.photoCount = this.analysis.authors.reduce((n, a) => n + (a.photos?.length || 0), 0);
      v.slideCount = this.analysis.slideshow?.length || 0;
      v.canStart = this.canStart();
    }
    if (this.phase === 'question' || this.phase === 'reveal') {
      const { n, card, votes, endsAt } = this.round;
      v.round = { n, total: this.deck.length, text: card.tic.text, kind: card.tic.kind, of: card.tic.of || null, media: mediaOf(card.tic), options: this.options };
      if (this.phase === 'reveal' && card.tic.detail) v.round.detail = card.tic.detail;
      if (this.phase === 'question') {
        Object.assign(v.round, { remaining: Math.max(0, endsAt - Date.now()), seconds: this.settings.seconds, myVote: votes[id] || null });
      } else {
        const { uses, others, topOther, example } = card.tic;
        Object.assign(v.round, { answer: card.owner, ownerMessages: this.member(card.owner).messages, uses, others, topOther, example, votes, deltas: this.round.deltas, last: n === this.deck.length });
      }
    }
    if (this.phase === 'ranking') {
      const { before, after, deltas } = this.ranking;
      v.ranking = {
        n: this.round.n, total: this.deck.length,
        rows: after.map(pid => {
          const p = this.players.get(pid);
          return { id: pid, name: p.author || 'Nouveau joueur', score: p.score, delta: deltas[pid] || 0, was: Math.max(0, before.indexOf(pid)) };
        }),
      };
    }
    if (this.phase === 'end') {
      v.slides = this.slides();
      v.portraits = this.options.map(name => ({
        name,
        tics: [
          ...this.records.filter(c => c.owner === name && c.tic.kind === 'record').map(c => c.tic.text),
          ...this.member(name).tics.filter(t => !t.file && t.kind !== 'message').slice(0, 4).map(t => (t.kind === 'habitude' ? `plein de ${t.text}` : t.kind === 'debut' ? `${t.text}…` : t.kind === 'fin' ? `…${t.text}` : t.text)),
        ],
      }));
    }
    return v;
  }
}
