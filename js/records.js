// Les records de chacun, tirés de l'heure et de la longueur des messages : qui répond le plus vite,
// qui relance le groupe après un long silence, qui écrit en pleine nuit, qui est le fantôme…
// et l'emoji préféré de chacun. Une question n'est posée que si quelqu'un est nettement en tête.

const CONVERSATION = 180;   // minutes : au-delà, un message n'est plus une réponse au précédent
const SILENCE = 8 * 60;     // minutes : un message après ce silence relance le groupe
const PAVE = 200;           // caractères
const RAFALE = 4;           // messages d'affilée
const EMOJI = /\p{Extended_Pictographic}/gu;
const LAUGH = /\b(?:mdr+|ptdr+|lol+|xd+|a?(?:ha){2,}h?|(?:ah){2,}a?|(?:hi){2,}|(?:hé){2,})\b/i;

// Message écrit en majuscules : au moins 6 lettres, et presque aucune minuscule.
function shouting(text) {
  const upper = (text.match(/\p{Lu}/gu) || []).length, lower = (text.match(/\p{Ll}/gu) || []).length;
  return upper >= 6 && upper >= 4 * lower;
}

const share = (n, total) => (total >= 20 ? n / total : null);

const median = list => {
  const s = [...list].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// name → statistiques, pour tous les membres de la discussion.
export function memberStats(chat) {
  const stats = new Map();
  const get = name => {
    if (!stats.has(name)) stats.set(name, { messages: 0, texts: 0, night: 0, early: 0, paves: 0, relaunches: 0, bursts: 0, shouts: 0, questions: 0, excited: 0, short: 0, laughs: 0, lastWords: 0, replies: [], emojis: new Map() });
    return stats.get(name);
  };
  let prev = null, run = 0;
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

  const out = new Map();
  for (const [name, s] of stats) {
    const fav = [...s.emojis].sort((a, b) => b[1] - a[1])[0];
    out.set(name, {
      messages: s.messages,
      reply: s.replies.length >= 10 ? median(s.replies) : null,
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
      emoji: fav && fav[1] >= 5 ? { e: fav[0], n: fav[1] } : null,
    });
  }
  return out;
}

const duration = m => (m < 1 ? "moins d'une minute" : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`);
const pct = x => `${Math.round(x * 100)} %`;

// Chaque record : la valeur à comparer, le sens (low : le plus petit gagne), un minimum pour le
// gagnant (min sur la valeur, need sur ses chiffres), et le texte de la révélation (w : gagnant, r : deuxième).
const RECORDS = [
  { id: 'rapide', text: 'répond le plus vite', low: true, value: s => s.reply,
    detail: (w, r) => `Répond en ${duration(w.s.reply)} en général, contre ${duration(r.s.reply)} pour ${r.name}.` },
  { id: 'relance', text: 'relance le groupe quand plus personne ne parle', value: s => s.relaunches, min: 3,
    detail: (w, r) => `A relancé le groupe ${w.s.relaunches} fois après plus de 8 h de silence (${r.name} : ${r.s.relaunches}).` },
  { id: 'fantome', text: 'est le fantôme du groupe', low: true, ratio: 0.6, wholeGroup: true, value: s => s.messages,
    detail: (w, r) => `Seulement ${w.s.messages} messages. Le plus discret après : ${r.name} (${r.s.messages}).` },
  { id: 'nuit', text: 'écrit le plus en pleine nuit', value: s => s.night, min: 0.03, need: s => s.nightCount >= 5,
    detail: (w, r) => `${pct(w.s.night)} de ses messages entre minuit et 6 h, contre ${pct(r.s.night)} pour ${r.name}.` },
  { id: 'pave', text: 'envoie les plus gros pavés', value: s => s.pave, min: 0.03, need: s => s.paveCount >= 5,
    detail: (w, r) => `${w.s.paveCount} messages de plus de ${PAVE} caractères (${pct(w.s.pave)}), contre ${pct(r.s.pave)} pour ${r.name}.` },
  { id: 'rafale', text: 'envoie ses messages en rafale', value: s => s.bursts, min: 3,
    detail: (w, r) => `${w.s.bursts} fois au moins ${RAFALE} messages d'affilée (${r.name} : ${r.s.bursts}).` },
  { id: 'bavard', text: "ne s'arrête jamais de parler", wholeGroup: true, value: s => s.messages,
    detail: (w, r) => `${w.s.messages} messages, contre ${r.s.messages} pour ${r.name}.` },
  { id: 'explosif', text: "est l'explosif du groupe (LES MAJUSCULES)", value: s => s.shouts, min: 0.01, need: s => s.shoutCount >= 3,
    detail: (w, r) => `${w.s.shoutCount} messages TOUT EN MAJUSCULES, soit ${pct(w.s.shouts)} (${r.name} : ${pct(r.s.shouts)}).` },
  { id: 'curieux', text: 'pose toujours des questions', value: s => s.questions, min: 0.05, need: s => s.questionCount >= 5,
    detail: (w, r) => `${pct(w.s.questions)} de ses messages sont des questions, contre ${pct(r.s.questions)} pour ${r.name}.` },
  { id: 'exclamation', text: "met des points d'exclamation partout", value: s => s.excited, min: 0.05, need: s => s.excitedCount >= 5,
    detail: (w, r) => `Dans ${pct(w.s.excited)} de ses messages, contre ${pct(r.s.excited)} pour ${r.name}.` },
  { id: 'telegraphe', text: 'répond en deux mots maximum', value: s => s.short, min: 0.1, need: s => s.shortCount >= 5,
    detail: (w, r) => `${pct(w.s.short)} de ses messages font un ou deux mots, contre ${pct(r.s.short)} pour ${r.name}.` },
  { id: 'rieur', text: 'rit de tout', value: s => s.laughs, min: 0.03, need: s => s.laughCount >= 5,
    detail: (w, r) => `${pct(w.s.laughs)} de ses messages sont des rires, contre ${pct(r.s.laughs)} pour ${r.name}.` },
  { id: 'dernier', text: 'a toujours le dernier mot', value: s => s.lastWords, min: 3,
    detail: (w, r) => `${w.s.lastWords} fois le dernier message avant 8 h de silence (${r.name} : ${r.s.lastWords}).` },
  { id: 'matinal', text: 'est debout avant tout le monde', value: s => s.early, min: 0.03, need: s => s.earlyCount >= 5,
    detail: (w, r) => `${pct(w.s.early)} de ses messages entre 5 h et 8 h, contre ${pct(r.s.early)} pour ${r.name}.` },
];

// members : [{ name, stats }] (les noms proposés au vote) ; everyone : tous les membres de la discussion,
// pour les records qui portent sur tout le groupe (le fantôme doit être le plus discret de tous, pas
// seulement des joueurs). → cartes { owner, tic: { kind: 'record' | 'favori', … } }
export function pickRecords(members, everyone = members) {
  const cards = [];
  for (const rec of RECORDS) {
    const ranked = (rec.wholeGroup ? everyone : members).filter(m => m.stats && rec.value(m.stats) != null)
      .map(m => ({ name: m.name, s: m.stats, v: rec.value(m.stats) }))
      .sort((a, b) => (rec.low ? a.v - b.v : b.v - a.v));
    if (ranked.length < 2) continue;
    const [w, r] = ranked;
    const clear = rec.low ? w.v <= (rec.ratio || 0.75) * r.v : w.v >= 1.3 * r.v && w.v >= (rec.min || 0);
    if (!clear || (rec.need && !rec.need(w.s)) || !members.some(m => m.name === w.name)) continue;
    cards.push({ owner: w.name, tic: { kind: 'record', id: rec.id, text: rec.text, detail: rec.detail(w, r), uses: 0, others: 0 } });
  }
  // Emoji préféré : seulement s'il n'est celui de personne d'autre.
  const favs = members.filter(m => m.stats?.emoji);
  for (const m of favs) {
    if (favs.some(o => o !== m && o.stats.emoji.e === m.stats.emoji.e)) continue;
    cards.push({ owner: m.name, tic: { kind: 'favori', id: 'emoji', text: m.stats.emoji.e, detail: `Son emoji préféré : envoyé dans ${m.stats.emoji.n} messages.`, uses: 0, others: 0 } });
  }
  return cards;
}

// Diaporama de fin (export avec médias) : les photos qui ont le plus fait réagir le groupe, avec les
// emojis envoyés juste après par les autres (dans les 15 minutes, sur une douzaine de messages).
const REACTION_WINDOW = 15;
const SLIDE_MAX_BYTES = 20 * 1024 * 1024;

export function bestPhotos(chat, files, max = 10) {
  const timeline = chat.timeline || [];
  const photos = [];
  timeline.forEach((e, i) => {
    const f = e.media === 'photo' && e.file && files.get(e.file);
    if (!f || f.size > SLIDE_MAX_BYTES) return;
    const counts = new Map();
    let replies = 0;
    for (let j = i + 1; j < timeline.length && j <= i + 12; j++) {
      const r = timeline[j];
      if (r.t - e.t > REACTION_WINDOW) break;
      if (r.author === e.author || !r.text) continue;
      replies++;
      for (const emoji of r.text.match(EMOJI) || []) counts.set(emoji, (counts.get(emoji) || 0) + 1);
    }
    const emojis = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([e, n]) => ({ e, n }));
    const reactions = [...counts.values()].reduce((a, b) => a + b, 0);
    photos.push({ file: e.file, author: e.author, emojis, score: 2 * reactions + replies + Math.random() });
  });
  return photos.sort((a, b) => b.score - a.score).slice(0, max).map(({ file, author, emojis }) => ({ file, author, emojis }));
}

// Messages cultes : ceux qui ont fait le plus réagir le groupe (emojis et réponses des autres juste
// après), à condition d'être montrables tels quels.
export function cultMessages(chat, max = 5) {
  const timeline = chat.timeline || [];
  const out = [];
  timeline.forEach((e, i) => {
    if (!e.text || e.text.length < 15 || e.text.length > 160 || /\b(?:https?:\/\/|www\.)|\d{4,}|@/i.test(e.text)) return;
    const counts = new Map();
    let replies = 0;
    for (let j = i + 1; j < timeline.length && j <= i + 10; j++) {
      const r = timeline[j];
      if (r.t - e.t > REACTION_WINDOW) break;
      if (r.author === e.author) continue;
      replies++;
      for (const emoji of (r.text || '').match(EMOJI) || []) counts.set(emoji, (counts.get(emoji) || 0) + 1);
    }
    const reactions = [...counts.values()].reduce((a, b) => a + b, 0);
    if (reactions < 3) return;
    out.push({ author: e.author, text: e.text, reactions, emojis: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4), score: 2 * reactions + replies });
  });
  return out.sort((a, b) => b.score - a.score).slice(0, max)
    .map(({ author, text, reactions, emojis }) => ({ author, text, detail: `${reactions} emojis en réaction juste après : ${emojis.map(([e, n]) => (n > 1 ? `${e} ×${n}` : e)).join(' ')}.` }));
}

// Montage de fin : les photos les plus commentées, plus les stickers et GIF les plus envoyés du groupe.
export function montageItems(chat, files, max = 24) {
  const counts = new Map();
  for (const m of chat.medias || []) {
    const f = m.file && files.get(m.file);
    if (!f || (m.kind !== 'sticker' && m.kind !== 'gif') || f.size > 1.5 * 1024 * 1024) continue;
    const key = f.key;
    if (!counts.has(key)) counts.set(key, { file: m.file, kind: m.kind, n: 0 });
    counts.get(key).n++;
  }
  const extras = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 8).map(({ file, kind }) => ({ file, kind }));
  const photos = bestPhotos(chat, files, max - extras.length).map(({ file }) => ({ file, kind: 'photo' }));
  return [...photos, ...extras];
}

