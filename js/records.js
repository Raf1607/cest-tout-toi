// Les records de chacun, tirés de l'heure et de la longueur des messages : qui répond le plus vite,
// qui relance le groupe après un long silence, qui écrit en pleine nuit, qui est le fantôme…
// et l'emoji préféré de chacun. Une question n'est posée que si quelqu'un est nettement en tête.
// Les textes (français ou anglais) sont dans i18n.js.

import { DICT } from './i18n.js';
import { TUNING as T } from './tuning.js';
import { score, superlative, median, sharp, strong, reliable } from './scoring.js';

const CONVERSATION = 180;   // minutes : au-delà, un message n'est plus une réponse au précédent
const SILENCE = 8 * 60;     // minutes : un message après ce silence relance le groupe
const PAVE = 200;           // caractères
const RAFALE = 4;           // messages d'affilée
const EMOJI = /\p{Extended_Pictographic}/gu;
const LINK = /\b(?:https?:\/\/|www\.)\S+/i;
const BIRTHDAY = /\b(?:joyeux|bon|bel|happy)\s+(?:anniv\w*|birthday|bday|b-day)|\bhbd\b|\bbon\s+anni\b/i;
const NEW_YEAR = /\bbonne\s+ann[ée]e\b|\bhappy\s+new\s+year\b|\bhny\b|\bmeilleurs\s+v(?:œ|oe)ux\b/i;
// Vœux de nouvel an : du 31 décembre au soir à la première semaine de janvier, comptés par année.
const newYear = t => { const d = new Date((t + 6 * 60) * 60000); return d.getUTCMonth() === 0 && d.getUTCDate() <= 7 ? 'ny:' + d.getUTCFullYear() : null; };
const LAUGH = /\b(?:mdr+|ptdr+|lol+|lmf?ao+|rofl|xd+|a?(?:ha){2,}h?|(?:ah){2,}a?|(?:hi){2,}|(?:h[eé]){2,})\b/i;

// Message écrit en majuscules : au moins 6 lettres, et presque aucune minuscule.
function shouting(text) {
  const upper = (text.match(/\p{Lu}/gu) || []).length, lower = (text.match(/\p{Ll}/gu) || []).length;
  return upper >= 6 && upper >= 4 * lower;
}

const share = (n, total) => (total >= 20 ? n / total : null);

// name → statistiques, pour tous les membres de la discussion.
export function memberStats(chat) {
  const stats = new Map();
  const get = name => {
    if (!stats.has(name)) stats.set(name, { messages: 0, texts: 0, night: 0, early: 0, paves: 0, relaunches: 0, bursts: 0, shouts: 0, questions: 0, excited: 0, short: 0, laughs: 0, lastWords: 0, replies: [], emojis: new Map(), edited: 0, links: 0, deleted: 0, wishFirst: 0, wishes: 0 });
    return stats.get(name);
  };
  let prev = null, run = 0;
  const wishes = new Map();   // anniversaire (par jour) ou nouvel an → premier à souhaiter, et qui a souhaité
  for (const e of chat.timeline || []) {
    const s = get(e.author);
    s.messages++;
    if (e.hour < 6) s.night++;
    if (e.hour >= 5 && e.hour < 8) s.early++;
    if (e.text) {
      s.texts++;
      if (e.text.length >= PAVE) s.paves++;
      if (shouting(e.text)) s.shouts++;
      if (e.text.includes('?')) s.questions++;
      if (e.text.includes('!')) s.excited++;
      if (e.text.trim().split(/\s+/).length <= 2) s.short++;
      if (LAUGH.test(e.text)) s.laughs++;
      if (LINK.test(e.text)) s.links++;
      if (e.edited) s.edited++;
      const wish = BIRTHDAY.test(e.text) ? 'anniv:' + Math.floor(e.t / 1440) : NEW_YEAR.test(e.text) ? newYear(e.t) : null;
      if (wish) {
        s.wishes++;
        if (!wishes.has(wish)) wishes.set(wish, { first: e.author, people: new Set() });
        wishes.get(wish).people.add(e.author);
      }
      for (const emoji of new Set(e.text.match(EMOJI) || [])) s.emojis.set(emoji, (s.emojis.get(emoji) || 0) + 1);
    }
    if (prev) {
      const gap = e.t - prev.t;
      if (prev.author !== e.author && gap >= 0 && gap <= CONVERSATION) s.replies.push(gap);
      if (gap >= SILENCE) { s.relaunches++; get(prev.author).lastWords++; }
    }
    if (prev && prev.author === e.author) run++;
    else {
      if (prev && run >= RAFALE) get(prev.author).bursts++;
      run = 1;
    }
    prev = e;
  }
  if (prev && run >= RAFALE) get(prev.author).bursts++;

  // Premier à souhaiter : seulement quand au moins deux personnes ont souhaité ce jour-là (un vrai « concours »).
  for (const w of wishes.values()) if (w.people.size >= 2) get(w.first).wishFirst++;
  for (const d of chat.deleted || []) get(d.author).deleted++;

  // Pour l'emoji préféré : combien de messages des autres le contiennent (pour mesurer s'il est marquant).
  const allTexts = [...stats.values()].reduce((n, s) => n + s.texts, 0);
  const allEmojis = new Map();
  for (const s of stats.values()) for (const [e, n] of s.emojis) allEmojis.set(e, (allEmojis.get(e) || 0) + n);
  const out = new Map();
  for (const [name, s] of stats) {
    const fav = [...s.emojis].sort((a, b) => b[1] - a[1])[0];
    // Part de ses messages avec cet emoji, rapportée à la même part chez les autres (lissée).
    const lift = fav ? (fav[1] / Math.max(1, s.texts)) / ((allEmojis.get(fav[0]) - fav[1] + 1) / Math.max(1, allTexts - s.texts + 1)) : 0;
    out.set(name, {
      messages: s.messages,
      reply: s.replies.length >= 10 ? median(s.replies) : null, replyCount: s.replies.length,
      relaunches: s.relaunches,
      night: s.messages >= 20 ? s.night / s.messages : null,
      nightCount: s.night,
      pave: s.texts >= 20 ? s.paves / s.texts : null,
      paveCount: s.paves,
      bursts: s.bursts,
      lastWords: s.lastWords,
      shouts: share(s.shouts, s.texts), shoutCount: s.shouts,
      questions: share(s.questions, s.texts), questionCount: s.questions,
      excited: share(s.excited, s.texts), excitedCount: s.excited,
      short: share(s.short, s.texts), shortCount: s.short,
      laughs: share(s.laughs, s.texts), laughCount: s.laughs,
      early: share(s.early, s.messages), earlyCount: s.early,
      emoji: fav && fav[1] >= 5 ? { e: fav[0], n: fav[1], lift } : null,
      wishFirst: s.wishFirst, deleted: s.deleted, edited: s.edited, links: s.links,
    });
  }
  return out;
}

// Chaque titre : la valeur comparée et sa nature, pour le score commun (js/scoring.js).
//   share : une part de ses messages (nuit, majuscules…) ; count : un nombre (relances, liens…) ;
//   low : le plus petit gagne (délai de réponse, nombre de messages du fantôme).
//   n : ses occurrences (fiabilité) ; wholeGroup : comparé à tout le groupe, pas seulement aux joueurs.
// Texte et révélation : DICT[lang].records[id].
const RECORDS = [
  { id: 'rapide', type: 'low', value: s => s.reply, n: s => s.replyCount },
  { id: 'relance', type: 'count', value: s => s.relaunches },
  { id: 'fantome', type: 'low', wholeGroup: true, value: s => s.messages, n: () => null },
  { id: 'nuit', type: 'share', value: s => s.night, n: s => s.nightCount },
  { id: 'pave', type: 'share', value: s => s.pave, n: s => s.paveCount },
  { id: 'rafale', type: 'count', value: s => s.bursts },
  { id: 'bavard', type: 'count', wholeGroup: true, value: s => s.messages, n: () => null },
  { id: 'explosif', type: 'share', value: s => s.shouts, n: s => s.shoutCount },
  { id: 'curieux', type: 'share', value: s => s.questions, n: s => s.questionCount },
  { id: 'exclamation', type: 'share', value: s => s.excited, n: s => s.excitedCount },
  { id: 'telegraphe', type: 'share', value: s => s.short, n: s => s.shortCount },
  { id: 'rieur', type: 'share', value: s => s.laughs, n: s => s.laughCount },
  { id: 'dernier', type: 'count', value: s => s.lastWords },
  { id: 'matinal', type: 'share', value: s => s.early, n: s => s.earlyCount },
  { id: 'anniv', type: 'count', value: s => s.wishFirst },
  { id: 'supprime', type: 'count', value: s => s.deleted },
  { id: 'retouche', type: 'count', value: s => s.edited },
  { id: 'liens', type: 'count', value: s => s.links },
];
const MIN_LEAD = 1.1;      // garde-fou : au moins 10 % d'avance sur le deuxième
const MIN_OCCURRENCES = 3;
const MIN_ACTIVE = 20;     // messages : en dessous, un membre ne compte pas (sauf pour le fantôme)

// Tous les titres possibles, chacun avec son score commun (0 à 1) : plus de seuil propre à chaque titre,
// seulement des garde-fous de bon sens. Les meilleurs seront posés (voir buildDeck dans game.js).
// members : [{ name, stats }] (les noms proposés au vote) ; everyone : tous les membres de la discussion.
// → cartes { owner, score, tic: { kind: 'record' | 'favori', … } }
export function pickRecords(members, everyone = members, lang = 'fr') {
  const L = DICT[lang] || DICT.fr;
  const N = { pave: PAVE, burst: RAFALE };
  const cards = [];
  for (const rec of RECORDS) {
    const pool = (rec.wholeGroup ? everyone : members.filter(m => (m.stats?.messages || 0) >= MIN_ACTIVE))
      .filter(m => m.stats && rec.value(m.stats) != null);
    const ranked = pool.map(m => ({ name: m.name, s: m.stats, v: rec.value(m.stats) }))
      .sort((a, b) => (rec.type === 'low' ? a.v - b.v : b.v - a.v));
    if (ranked.length < 2) continue;
    const [w, r] = ranked;
    if (!members.some(m => m.name === w.name) || (rec.type === 'low' && !(w.v > 0))) continue;
    const n = (rec.n || rec.value)(w.s);
    if (n != null && n < MIN_OCCURRENCES) continue;
    const med = median(ranked.slice(1).map(x => x.v));
    const { score, lead } = superlative(T.fun.record[rec.id] ?? 0.6, rec.type, w.v, r.v, med, n);
    if (lead < MIN_LEAD) continue;
    const [text, detail] = L.records[rec.id];
    cards.push({ owner: w.name, score, tic: { kind: 'record', id: rec.id, text, detail: detail(w, r, L.duration, L.pct, N), uses: 0, others: 0 } });
  }
  // Emoji préféré : seulement s'il n'est celui de personne d'autre. Netteté et intensité : à quel point
  // il l'emploie plus que les autres ; fiabilité : dans combien de ses messages.
  const favs = members.filter(m => m.stats?.emoji);
  for (const m of favs) {
    if (favs.some(o => o !== m && o.stats.emoji.e === m.stats.emoji.e)) continue;
    const { e, n, lift = 1.3 } = m.stats.emoji;
    cards.push({ owner: m.name, score: score(T.fun.favori, sharp(lift), strong(lift), reliable(n)), tic: { kind: 'favori', id: 'emoji', text: e, detail: L.favDetail(n), uses: 0, others: 0 } });
  }
  return cards;
}

// Réactions : ce que les autres envoient juste après un message ou une photo (dans les 15 minutes,
// sur une dizaine de messages). Chaque emoji compte comme une réaction, chaque message comme une réponse.
// Le score (2 × réactions + réponses) sert partout : photos, messages cultes, « qui a écrit ça ? ».
const REACTION_WINDOW = 15;
const SLIDE_MAX_BYTES = 20 * 1024 * 1024;

function reactionsAt(timeline, i, look, textOnly) {
  const e = timeline[i], counts = new Map();
  let replies = 0, talk = 0;
  for (let j = i + 1; j < timeline.length && j <= i + look; j++) {
    const r = timeline[j];
    if (r.t - e.t > REACTION_WINDOW) break;
    // L'auteur enchaîne (un autre message, une photo) : les réactions suivantes sont pour la suite.
    if (r.author === e.author) break;
    if (textOnly && !r.text) continue;
    replies++;
    for (const emoji of (r.text || '').match(EMOJI) || []) counts.set(emoji, (counts.get(emoji) || 0) + 1);
    // Deux vraies réponses (pas des rires) : la conversation est passée à autre chose.
    if (r.text && !isReaction(r.text) && !LAUGH.test(r.text) && ++talk >= 2) break;
  }
  const reactions = [...counts.values()].reduce((a, b) => a + b, 0);
  return { reactions, replies, counts, score: 2 * reactions + replies };
}

// Score de réaction de chaque photo de l'export : fichier → { score, reactions, emojis }.
export function photoReactions(chat, files) {
  const timeline = chat.timeline || [];
  const out = new Map();
  timeline.forEach((e, i) => {
    const f = e.media === 'photo' && e.file && files.get(e.file);
    if (!f || f.size > SLIDE_MAX_BYTES) return;
    const { reactions, counts, score } = reactionsAt(timeline, i, 12, true);
    // Rafale : combien de photos la même personne a envoyées dans les 10 minutes autour (une photo seule
    // est souvent plus choisie qu'une parmi douze prises à la suite).
    let burst = 1;
    for (let j = i - 1; j >= 0 && e.t - timeline[j].t <= 10; j--) if (timeline[j].author === e.author && timeline[j].media === 'photo') burst++;
    for (let j = i + 1; j < timeline.length && timeline[j].t - e.t <= 10; j++) if (timeline[j].author === e.author && timeline[j].media === 'photo') burst++;
    out.set(e.file, { author: e.author, score, reactions, burst, day: Math.floor(e.t / 1440), emojis: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([e, n]) => ({ e, n })) });
  });
  return out;
}

// Réaction plutôt que message : surtout des rires et des emojis, avec trois mots au plus.
const REACTION_WORDS = /\b(?:mdr+|ptdr+|lol+|lmf?ao+|x+d+|a?(?:ha){2,}h?|(?:ah){2,}a?|jpp|omg|wtf|dead|crying|pleure|morte?|meurs|tue|possible|way|non+|no+)\b/giu;
export function isReaction(text) {
  const rest = text.replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200d|\ufe0f/gu, ' ').replace(REACTION_WORDS, ' ');
  const words = rest.split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  return words.length <= 3 && (words.length < text.split(/\s+/).length || /\p{Extended_Pictographic}/u.test(text));
}

// Score de réaction de chaque message texte : « auteur\ntexte » → { score, reactions, emojis }.
export function messageReactions(chat) {
  const timeline = chat.timeline || [];
  const out = new Map();
  timeline.forEach((e, i) => {
    if (!e.text) return;
    const { reactions, replies, counts, score } = reactionsAt(timeline, i, 10, false);
    if (!replies) return;
    const key = e.author + '\n' + e.text;
    if (!out.has(key) || out.get(key).score < score) out.set(key, { score, reactions, emojis: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4) });
  });
  return out;
}

// Photos du montage et du diaporama de fin : celles qui ont le plus fait réagir le groupe, la meilleure
// d'abord. Une photo envoyée seule vaut plus qu'une parmi douze (score divisé par 1 + 0,5 × (rafale − 1)) ;
// au plus 3 photos par personne ; on évite deux photos du même jour à la suite (tant que l'écart de score
// reste sous 20 %) ; une photo sans aucune réaction ne passe que pour atteindre 6. Pas de hasard, sauf
// pour départager des égalités.
const PER_AUTHOR = 3, COLD_UNTIL = 6, SAME_DAY_GAP = 0.2;
export function bestPhotos(chat, files, max = 10, scores = photoReactions(chat, files)) {
  const list = [...scores].map(([file, p]) => ({
    file, author: p.author, emojis: p.emojis, day: p.day, raw: p.score,
    score: p.score / (1 + 0.5 * ((p.burst || 1) - 1)), tie: Math.random(),
  })).sort((a, b) => b.score - a.score || a.tie - b.tie);
  const out = [], per = new Map();
  const free = p => (per.get(p.author) || 0) < PER_AUTHOR;
  const pick = (pool, limit) => {
    while (out.length < limit) {
      let i = pool.findIndex(free);
      if (i < 0) return;
      const last = out[out.length - 1];
      if (last && pool[i].day === last.day) {
        const j = pool.findIndex((p, k) => k > i && free(p) && p.day !== last.day && p.score >= (1 - SAME_DAY_GAP) * pool[i].score);
        if (j >= 0) i = j;
      }
      const [p] = pool.splice(i, 1);
      per.set(p.author, (per.get(p.author) || 0) + 1);
      out.push(p);
    }
  };
  pick(list.filter(p => p.raw > 0), max);
  pick(list.filter(p => p.raw <= 0), Math.min(max, COLD_UNTIL));
  return out.map(({ file, author, emojis, score }) => ({ file, author, emojis, score }));
}

// Messages cultes : ceux qui ont fait le plus réagir le groupe, à condition d'être montrables tels quels.
export function cultMessages(chat, max = 8, lang = 'fr', scores = messageReactions(chat)) {
  const L = DICT[lang] || DICT.fr;
  const out = [];
  for (const [key, r] of scores) {
    const [author, text] = [key.slice(0, key.indexOf('\n')), key.slice(key.indexOf('\n') + 1)];
    if (text.length < 15 || text.length > 160 || /\b(?:https?:\/\/|www\.)|\d{4,}|@/i.test(text) || r.reactions < 3) continue;
    // Un message qui n'est lui-même qu'une réaction (« pas possible 😂 », « je suis mort mdr ») n'est pas culte :
    // il hérite des rires adressés au message d'avant.
    if (isReaction(text)) continue;
    out.push({ author, text, ...r });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max)
    .map(({ author, text, reactions, score, emojis }) => ({ author, text, reactions, score, detail: L.cultDetail(reactions, emojis.map(([e, n]) => (n > 1 ? `${e} ×${n}` : e)).join(' ')) }));
}

// Montage de fin : les photos les plus commentées, plus les stickers et GIF les plus envoyés du groupe.
export function montageItems(chat, files, max = 24, scores = photoReactions(chat, files)) {
  const counts = new Map();
  for (const m of chat.medias || []) {
    const f = m.file && files.get(m.file);
    if (!f || (m.kind !== 'sticker' && m.kind !== 'gif') || f.size > 1.5 * 1024 * 1024) continue;
    const key = f.key;
    if (!counts.has(key)) counts.set(key, { file: m.file, kind: m.kind, n: 0 });
    counts.get(key).n++;
  }
  const extras = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 12).map(({ file, kind }) => ({ file, kind }));
  const photos = bestPhotos(chat, files, max - extras.length, scores).map(({ file }) => ({ file, kind: 'photo' }));
  return [...photos, ...extras];
}

