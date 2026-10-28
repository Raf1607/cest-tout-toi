// Les records de chacun, tirés de l'heure et de la longueur des messages : qui répond le plus vite,
// qui relance le groupe après un long silence, qui écrit en pleine nuit, qui est le fantôme…
// et l'emoji préféré de chacun. Une question n'est posée que si quelqu'un est nettement en tête.

const CONVERSATION = 180;   // minutes : au-delà, un message n'est plus une réponse au précédent
const SILENCE = 8 * 60;     // minutes : un message après ce silence relance le groupe
const PAVE = 200;           // caractères
const RAFALE = 4;           // messages d'affilée
const EMOJI = /\p{Extended_Pictographic}/gu;

const median = list => {
  const s = [...list].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// name → statistiques, pour tous les membres de la discussion.
export function memberStats(chat) {
  const stats = new Map();
  const get = name => {
    if (!stats.has(name)) stats.set(name, { messages: 0, texts: 0, night: 0, paves: 0, relaunches: 0, bursts: 0, replies: [], emojis: new Map() });
    return stats.get(name);
  };
  let prev = null, run = 0;
  for (const e of chat.timeline || []) {
    const s = get(e.author);
    s.messages++;
    if (e.hour < 6) s.night++;
    if (e.text) {
      s.texts++;
      if (e.text.length >= PAVE) s.paves++;
      for (const emoji of new Set(e.text.match(EMOJI) || [])) s.emojis.set(emoji, (s.emojis.get(emoji) || 0) + 1);
    }
    if (prev) {
      const gap = e.t - prev.t;
      if (prev.author !== e.author && gap >= 0 && gap <= CONVERSATION) s.replies.push(gap);
      if (gap >= SILENCE) s.relaunches++;
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

