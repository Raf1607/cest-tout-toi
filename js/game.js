// La partie, telle que la tient le téléphone de l'hôte. Tout l'état vit ici ; chaque
// téléphone reçoit seulement ce qu'il doit afficher (jamais la réponse avant la révélation).

import { pickRecords } from './records.js';

export const ROUNDS = [6, 10, 15, 20];
export const SECONDS = [15, 25, 40];
const LAST_CALL = 5000;   // quand tout le monde a voté, il reste ce temps pour changer d'avis

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const ticId = (owner, t) => owner + '|' + (t.id || t.file || t.text);
const FAMILY = { expr: 'mots', mot: 'mots', ponct: 'mots', emoji: 'emoji', sticker: 'media', gif: 'media', habitude: 'habitude' };

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
function buildDeck(owners, total, used, withPhotos) {
  const queues = owners.map(a => {
    const fresh = a.tics.filter(t => !used.has(ticId(a.name, t)));
    let list = varied(fresh.length ? fresh : a.tics.slice());
    list = [...shuffle(list.slice(0, 4)), ...shuffle(list.slice(4))];
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
    this.settings = { rounds: 10, seconds: 25, absent: false, photos: false };
    this.phase = 'lobby';
    this.used = new Set();
    this.deck = [];
    this.options = [];
    this.round = null;
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
    // Records (« qui répond le plus vite ? »…) : environ une manche sur quatre, réparties dans la partie.
    this.records = pickRecords(this.options.map(name => ({ name, stats: this.member(name).stats })));
    const fresh = this.records.filter(c => !this.used.has(ticId(c.owner, c.tic)));
    const records = shuffle(fresh.length ? fresh : this.records.slice()).slice(0, Math.round(this.settings.rounds / 4));
    this.deck = buildDeck(owners, this.settings.rounds - records.length, this.used, this.settings.photos);
    records.forEach((card, i) => {
      // Au plus près de sa place idéale, sans la même personne deux manches de suite.
      const target = Math.min(this.deck.length, Math.round(((i + 0.5) * this.deck.length) / records.length) + i);
      const fits = j => j >= 0 && j <= this.deck.length && this.deck[j - 1]?.owner !== card.owner && this.deck[j]?.owner !== card.owner;
      let at = target;
      for (let d = 1; !fits(at) && d <= this.deck.length; d++) at = fits(target - d) ? target - d : target + d;
      this.deck.splice(fits(at) ? at : target, 0, card);
    });
    for (const p of this.players.values()) p.score = 0;
    this.index = 0;
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

  // Tout le monde a voté : on raccourcit le temps restant, en laissant quelques secondes
  // pour changer d'avis au dernier moment.
  checkVotes() {
    if (this.phase !== 'question') return;
    const present = [...this.players.values()].filter(p => p.connected);
    if (!present.length || !present.every(p => this.round.votes[p.id])) return;
    this.round.allVoted = true;
    if (this.round.endsAt - Date.now() > LAST_CALL) {
      this.round.endsAt = Date.now() + LAST_CALL;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.reveal(), LAST_CALL + 300);
    }
  }

  reveal() {
    if (this.phase !== 'question') return;
    clearTimeout(this.timer);
    for (const [id, author] of Object.entries(this.round.votes)) {
      if (author === this.round.card.owner && this.players.has(id)) this.players.get(id).score++;
    }
    this.phase = 'reveal';
    this.changed();
  }

  next() {
    this.index++;
    if (this.index < this.deck.length) return this.ask();
    this.phase = 'end';
    this.changed();
  }

  changed() { this.onChange?.(); }

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
      v.canStart = this.canStart();
    }
    if (this.phase === 'question' || this.phase === 'reveal') {
      const { n, card, votes, endsAt } = this.round;
      v.round = { n, total: this.deck.length, text: card.tic.text, kind: card.tic.kind, of: card.tic.of || null, media: mediaOf(card.tic), options: this.options };
      if (this.phase === 'reveal' && card.tic.detail) v.round.detail = card.tic.detail;
      if (this.phase === 'question') {
        Object.assign(v.round, { remaining: Math.max(0, endsAt - Date.now()), seconds: this.settings.seconds, votes, allVoted: !!this.round.allVoted });
      } else {
        const { uses, others, topOther, example } = card.tic;
        Object.assign(v.round, { answer: card.owner, ownerMessages: this.member(card.owner).messages, uses, others, topOther, example, votes, last: n === this.deck.length });
      }
    }
    if (this.phase === 'end') {
      v.portraits = this.options.map(name => ({
        name,
        tics: [
          ...this.records.filter(c => c.owner === name && c.tic.kind === 'record').map(c => c.tic.text),
          ...this.member(name).tics.filter(t => !t.file).slice(0, 4).map(t => (t.kind === 'habitude' ? `plein de ${t.text}` : t.text)),
        ],
      }));
    }
    return v;
  }
}
