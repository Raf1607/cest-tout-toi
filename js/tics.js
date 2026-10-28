// Repère les tics de langage de chaque membre d'une discussion : les mots, expressions,
// emojis et ponctuations qu'il emploie souvent ET nettement plus que chacun des autres.
//
// Tout se compte en messages (un mot répété dix fois dans un message compte une fois).
// Pour chaque membre a et chaque tournure g :
//   taux(a)   = (messages de a contenant g + K·p) / (messages de a + K)
//               où p est le taux global de g : un petit bavard est ramené vers la moyenne
//   écart     = taux(a) / taux de tous les autres réunis
//   score     = log2(écart) × log2(1 + utilisations par a)
// On exige un écart d'au moins 2,5, et que a devance nettement chacun des autres (test de deux
// proportions contre le deuxième : un petit bavard peut avoir un taux élevé par hasard).
// Si ça laisse trop peu de tics (gros groupe, tics peu marqués), on assouplit ces seuils.
// On écarte les tournures concentrées sur une seule conversation (un sujet, pas un tic),
// les prénoms et les noms propres.
//
// Les médias suivent la même règle : « qui envoie le plus de stickers » (habitudes, même
// dans un export sans médias) et, dans un export avec médias, le sticker ou le GIF fétiche
// de chacun (les fichiers identiques sont regroupés grâce à leur taille et leur CRC).

import { memberStats, bestPhotos } from './records.js';

const MAX_MESSAGES = 60000;   // au-delà, on ne garde que les plus récents
const MIN_MESSAGES = 20;      // en dessous, un membre n'est pas analysé
const MIN_USES = 3;
const MAX_GRAM = 4;
const K = 30;
const MAX_TICS = 12;
// Du plus exigeant au plus souple ; lift : écart minimal, z : avance minimale sur le deuxième,
// habit : écart minimal pour « qui envoie le plus de… » (être nettement en tête suffit).
const LEVELS = [
  { lift: 2.5, z: 2.5, habit: 1.6 },
  { lift: 2, z: 2, habit: 1.4 },
  { lift: 1.6, z: 1.5, habit: 1.25 },
];
const MAX_MEDIA_BYTES = 3 * 1024 * 1024; // un sticker ou un GIF plus lourd ne sera pas envoyé aux joueurs
const HABITS = { sticker: 'stickers', gif: 'GIF', photo: 'photos', video: 'vidéos', vocal: 'vocaux', media: 'médias' };

const STOP = new Set(`a à ai aie as au aux avait avais avez avoir avons ça ce ceci cela celle celui ces cet cette chez ci
  comme d dans de des du elle elles en es est et étais était été être eu eux fait faire il ils j je l la le les leur leurs
  lui m ma me même mes moi mon n ne ni nos notre nous on ont ou où par pas pour qu que quel quelle qui s sa sans se ses si
  son sont sur t ta te tes toi ton tu un une vos votre vous y avec c'est j'ai d'un d'une qu'il qu'on n'est l'a l'ai m'a t'as
  s'est c'était il y the to of and is it in i you that a an`.split(/\s+/));

// Une expression ne se termine pas sur un mot « en attente » (« du coup je », « en vrai le »).
const DANGLING = new Set(`a à au aux avec ce ces cette d de des du dans en et j je l la le les leur ma mais me mes mon n ne
  nos notre on ou par pour qu que qui s sa se ses si son sur t ta te tes ton tu un une vos votre y il ils elle elles nous
  vous c'est j'ai est`.split(/\s+/));

// Tics connus, légèrement favorisés à score égal.
const KNOWN = `du coup|en vrai|de ouf|genre|grave|wesh|frère|frérot|mdr|ptdr|jpp|osef|bref|voilà|carrément|tkt|t'inquiète|
  askip|jsp|chaud|mec|wallah|sah|ouais|nan|bah|ben|bon ben|bon bah|allez|bisous|biz|bises|coucou|hello|yo|hey|stylé|ouf|
  lourd|énorme|nickel|impec|cimer|franchement|clairement|littéralement|limite|sérieux|sérieusement|j'avoue|on verra|
  c'est clair|trop bien|trop|ok ok|oklm|tranquille|tranquillou|vas-y|bg|frr|wsh|ptn|putain|bordel|zut|mince|oh là là|
  ah bon|ah ouais|en mode|de fou|absolument|exactement|parfait|top|super|génial|cool|chouette|à plus|à toute|ciao|bisou|
  la base|pas de souci|pas de soucis|aucun souci|t'as vu|tu vois|quoi|enfin bref|bon courage|en fait|au final|bon|ok`;

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const TOKEN_RE = /(\p{Extended_Pictographic})|([\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*)|([!?]{2,}|\.{2,}|…)/gu;
const BREAK_RE = /[.,;:!?()"«»\n]/;

function normWord(w) {
  w = w.toLowerCase().replace(/’/g, "'").replace(/(.)\1{2,}/gu, '$1$1$1');
  if (w.length >= 4 && /^[ah]+$/.test(w) && w.includes('a') && w.includes('h')) {
    return (w[0] === 'a' ? 'ahah' : 'haha') + (w.length >= 6 ? (w[0] === 'a' ? 'ah' : 'ha') : '');
  }
  return w;
}

function normPunct(p) {
  if (/^[.…]+$/.test(p)) return '...';
  if (/^!+$/.test(p)) return '!!!';
  if (/^\?+$/.test(p)) return '???';
  return '?!';
}

// Découpe un message en jetons {k: clé normalisée, kind, s, e (positions dans le texte), start (début de phrase)}.
function tokenize(text) {
  const out = [];
  const blank = s => ' '.repeat(s.length);           // garde les positions intactes
  let prev = null;
  for (const m of text.replace(URL_RE, blank).replace(/@\S+/g, blank).matchAll(TOKEN_RE)) {
    const s = m.index, e = s + m[0].length;
    const start = !prev || prev.kind !== 'word' || /[.!?…\n]/.test(text.slice(prev.e, s));
    let t;
    if (m[1]) t = { k: m[1], kind: 'emoji', s, e, start };
    else if (m[2]) t = { k: normWord(m[2]), kind: 'word', s, e, start, cap: /^\p{Lu}\p{Ll}/u.test(m[2]) };
    else t = { k: normPunct(m[3]), kind: 'ponct', s, e, start };
    out.push(t);
    prev = t;
  }
  return out;
}

function acceptable(words) {
  if (words.length === 1) {
    const w = words[0];
    return !STOP.has(w) && !/^\d+$/.test(w) && w.length <= 25 && w.length >= 2;
  }
  return !DANGLING.has(words[words.length - 1]) && words.some(w => !STOP.has(w) && !/^\d+$/.test(w));
}

// Énumère les tournures d'un message (dédoublonnées) ; cb(clé, premier jeton, dernier jeton).
function grams(text, tokens, cb) {
  const seen = new Set();
  const emit = (key, a, b) => { if (!seen.has(key)) { seen.add(key); cb(key, a, b); } };
  let run = [];
  const flush = () => {
    for (let i = 0; i < run.length; i++) {
      for (let n = 1; n <= MAX_GRAM && i + n <= run.length; n++) {
        const words = run.slice(i, i + n).map(t => t.k);
        if (acceptable(words)) emit(words.join(' '), run[i], run[i + n - 1]);
      }
    }
    run = [];
  };
  let prev = null;
  for (const t of tokens) {
    if (t.kind !== 'word') {
      flush();
      emit(t.k, t, t);
    } else {
      if (prev && BREAK_RE.test(text.slice(prev.e, t.s))) flush();
      run.push(t);
    }
    prev = t;
  }
  flush();
}

const kindOf = key => key.includes(' ') ? 'expr' : /^\p{Extended_Pictographic}$/u.test(key) ? 'emoji'
  : /^[.?!]+$/.test(key) ? 'ponct' : 'mot';

// Mots porteurs d'une tournure, réduits à leur squelette (« mdrrr » → « mdr », « ahahah » → « ah »).
// Les clés des médias (#habitude, @fichier) ne se confondent avec rien.
function contentWords(key) {
  if (/^[#@]/.test(key)) return [key];
  return key.split(' ').filter(w => !STOP.has(w))
    .map(w => w.replace(/(.)\1+/gu, '$1').replace(/^(?:ah)+a?$/, 'ah').replace(/^(?:ha)+h?$/, 'ha'));
}

// Test de deux proportions : c1/n1 est-il vraiment plus élevé que c2/n2 ?
function zScore(c1, n1, c2, n2) {
  const p = (c1 + c2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se ? (c1 / n1 - c2 / n2) / se : 0;
}

// Le membre a s'approprie-t-il cette tournure ? c : utilisations par membre, totals : messages par membre,
// rule : { lift, z, share } (share : part minimale des utilisations qui sont les siennes).
function owned(c, totals, a, rule) {
  let C = 0, M = 0;
  for (let b = 0; b < c.length; b++) { C += c[b]; M += totals[b]; }
  const p = C / M;
  const rate = b => (c[b] + K * p) / (totals[b] + K);
  const rest = (C - c[a] + K * p) / (M - totals[a] + K);   // tous les autres réunis
  const lift = rest ? rate(a) / rest : Infinity;
  if (lift < rule.lift || c[a] / C < rule.share) return null;
  let top = -1;
  for (let b = 0; b < c.length; b++) if (b !== a && totals[b] >= MIN_MESSAGES && (top < 0 || rate(b) > rate(top))) top = b;
  if (top >= 0 && (rate(top) >= rate(a) || zScore(c[a], totals[a], c[top], totals[top]) < rule.z)) return null;
  let other = -1;
  for (let b = 0; b < c.length; b++) if (b !== a && c[b] && (other < 0 || c[b] > c[other])) other = b;
  return { lift: Math.min(lift, 99), others: C - c[a], other };
}

const spreadOk = (spread, c) => spread >= Math.min(4, Math.max(2, Math.ceil(c * 0.3)));

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// files (export avec médias) : nom de fichier → { key, size }, où key identifie le contenu.
// On commence par les seuils les plus exigeants, et on les assouplit tant que trop peu de
// membres ont des tics (au moins deux avec 3 tics, et la moitié des membres avec au moins un).
export function analyze(chat, files = new Map()) {
  let result;
  for (let level = 0; level < LEVELS.length; level++) {
    result = analyzeAt(chat, files, level);
    const n = result.authors.filter(a => a.messages >= MIN_MESSAGES).length;
    const withTics = result.authors.filter(a => a.tics.length).length;
    if (result.authors.filter(a => a.tics.length >= 3).length >= Math.min(2, n) && withTics >= Math.ceil(n / 2)) break;
  }
  return result;
}

function analyzeAt(chat, files, level) {
  const messages = chat.messages.slice(-MAX_MESSAGES);
  const medias = chat.medias || [];
  const names = [...new Set([...messages, ...medias].map(m => m.author))];
  const index = new Map(names.map((n, i) => [n, i]));
  const A = names.length;
  const perAuthor = new Int32Array(A);           // messages écrits
  for (const m of messages) perAuthor[index.get(m.author)]++;
  const perAll = Int32Array.from(perAuthor);     // messages écrits + médias
  for (const m of medias) perAll[index.get(m.author)]++;
  const M = messages.length;
  const records = memberStats(chat);
  const active = perAll.filter(n => n >= MIN_MESSAGES).length;
  const { lift, z, habit } = LEVELS[level];
  const share = Math.min(0.34, 2 / Math.max(active, 1));   // dans un gros groupe, les autres réunis pèsent lourd
  const rule = { lift, z, share }, habitRule = { lift: habit, z, share };

  // Une tournure doit revenir dans plusieurs conversations : on compte les jours distincts,
  // ou des tranches de la discussion si elle tient en quelques jours.
  const days = new Map();
  for (const m of [...messages, ...medias]) if (!days.has(m.day)) days.set(m.day, days.size);
  const chunk = Math.ceil(M / 20);
  const spreadKey = days.size >= 8 ? i => days.get(messages[i].day) : i => Math.floor(i / chunk);

  const nameWords = new Set();
  for (const n of names) for (const w of tokenize(n)) if (w.kind === 'word' && w.k.length >= 3) nameWords.add(w.k);

  const tokenized = messages.map(m => tokenize(m.text));

  // 1er passage : dans combien de messages apparaît chaque tournure.
  const total = new Map();
  messages.forEach((m, i) => grams(m.text, tokenized[i], key => total.set(key, (total.get(key) || 0) + 1)));

  // 2e passage : détail par membre, pour les tournures assez fréquentes.
  const stats = new Map();
  for (const [key, c] of total) {
    if (c >= MIN_USES) stats.set(key, { c: new Int32Array(A), spread: new Int32Array(A), last: new Int32Array(A).fill(-1), cap: 0, mid: 0 });
  }
  total.clear();
  messages.forEach((m, i) => {
    const a = index.get(m.author), sk = spreadKey(i);
    grams(m.text, tokenized[i], (key, first) => {
      const st = stats.get(key);
      if (!st) return;
      st.c[a]++;
      if (st.last[a] !== sk) { st.spread[a]++; st.last[a] = sk; }
      if (first.kind === 'word' && !first.start) { st.mid++; if (first.cap) st.cap++; }
    });
  });

  // Noms propres : des mots écrits avec une Majuscule en milieu de phrase.
  // (On exige que ces milieux de phrase soient fréquents : « ok ok Bref. » ne fait pas de « bref » un prénom.)
  for (const [key, st] of stats) {
    if (key.includes(' ') || st.mid < 3 || st.cap / st.mid <= 0.6) continue;
    if (st.mid >= 0.3 * st.c.reduce((x, y) => x + y, 0)) nameWords.add(key);
  }

  const known = new Set(KNOWN.split('|').map(s => tokenize(s.trim()).map(t => t.k).join(' ')));
  const candidates = names.map(() => []);
  for (const [key, st] of stats) {
    const words = key.split(' ');
    if (words.some(w => nameWords.has(w))) continue;
    const kind = kindOf(key);
    for (let a = 0; a < A; a++) {
      const c = st.c[a];
      if (c < MIN_USES || perAuthor[a] < MIN_MESSAGES || !spreadOk(st.spread[a], c)) continue;
      const own = owned(st.c, perAuthor, a, rule);
      if (!own) continue;
      let boost = known.has(key) ? 1.3 : 1;
      if (kind === 'expr' && words.length <= 3) boost *= 1.2;
      if (kind === 'ponct') boost *= 0.7;
      candidates[a].push(candidate(key, kind, st.c, a, own, boost));
    }
  }

  function candidate(key, kind, c, a, own, boost = 1) {
    return {
      key, kind, uses: c[a], others: own.others, lift: own.lift,
      topOther: own.other >= 0 ? { name: names[own.other], uses: c[own.other] } : null,
      score: Math.log2(Math.min(own.lift, 64)) * Math.log2(1 + c[a]) * boost,
    };
  }

  // Médias. Habitudes : qui envoie le plus de stickers, de GIF, de vocaux…
  const mediaDay = m => days.get(m.day) ?? -1;
  const byKind = new Map();
  for (const m of medias) {
    if (!HABITS[m.kind]) continue;
    if (!byKind.has(m.kind)) byKind.set(m.kind, { c: new Int32Array(A), spread: new Int32Array(A), last: new Int32Array(A).fill(-2) });
    const st = byKind.get(m.kind), a = index.get(m.author), d = mediaDay(m);
    st.c[a]++;
    if (st.last[a] !== d) { st.spread[a]++; st.last[a] = d; }
  }
  for (const [kind, st] of byKind) {
    for (let a = 0; a < A; a++) {
      if (st.c[a] < MIN_USES || perAll[a] < MIN_MESSAGES || (days.size >= 8 && !spreadOk(st.spread[a], st.c[a]))) continue;
      const own = owned(st.c, perAll, a, habitRule);
      if (own) candidates[a].push({ ...candidate('#' + kind, 'habitude', st.c, a, own), text: HABITS[kind], of: kind });
    }
  }

  // Sticker et GIF fétiches (export avec médias) : le même fichier envoyé encore et encore.
  const signatures = new Map();
  const photos = names.map(() => []);
  for (const m of medias) {
    const f = m.file && files.get(m.file);
    if (!f) continue;
    const a = index.get(m.author);
    if (m.kind === 'photo') { photos[a].push(m.file); continue; }
    if (m.kind !== 'sticker' && m.kind !== 'gif') continue;
    const key = '@' + m.kind + ':' + f.key;
    if (!signatures.has(key)) signatures.set(key, { kind: m.kind, c: new Int32Array(A), spread: new Int32Array(A), last: new Int32Array(A).fill(-2), file: null });
    const st = signatures.get(key), d = mediaDay(m);
    st.c[a]++;
    if (st.last[a] !== d) { st.spread[a]++; st.last[a] = d; }
    if (f.size <= MAX_MEDIA_BYTES) st.file = m.file;
  }
  for (const [key, st] of signatures) {
    if (!st.file) continue;
    for (let a = 0; a < A; a++) {
      if (st.c[a] < MIN_USES || perAll[a] < MIN_MESSAGES || (days.size >= 8 && !spreadOk(st.spread[a], st.c[a]))) continue;
      const own = owned(st.c, perAll, a, rule);
      if (own) candidates[a].push({ ...candidate(key, st.kind, st.c, a, own, 1.3), text: st.kind === 'gif' ? 'ce GIF' : 'ce sticker', file: st.file });
    }
  }

  // Sélection : les meilleurs, sans trop d'emojis ni de ponctuation, et sans doublons :
  // une tournure qui partage un mot avec un tic déjà retenu (« du coup » / « coup je suis »,
  // « mdrr » / « mdrrr ») est écartée, sauf si elle le prolonge presque à chaque fois
  // (« voilà » → « voilà voilà »), auquel cas elle le remplace.
  const picked = candidates.map(list => {
    list.sort((x, y) => y.score - x.score);
    const out = [], limits = { emoji: 2, ponct: 1, sticker: 2, gif: 2, habitude: 2 };
    for (const t of list) {
      if (out.length >= MAX_TICS) break;
      if (limits[t.kind] === 0) continue;
      const mine = contentWords(t.key);
      const clash = out.filter(o => contentWords(o.key).some(w => mine.includes(w)));
      if (clash.length === 1 && ` ${t.key} `.includes(` ${clash[0].key} `) && t.uses >= 0.8 * clash[0].uses) {
        out[out.indexOf(clash[0])] = t;
        continue;
      }
      if (clash.length) continue;
      if (t.kind in limits) limits[t.kind]--;
      out.push(t);
    }
    return out;
  });

  // 3e passage : forme la plus courante telle qu'écrite, et un message d'exemple.
  const wanted = picked.map(list => new Map(list.filter(t => !/^[#@]/.test(t.key)).map(t => [t.key, { t, forms: new Map(), examples: [] }])));
  messages.forEach((m, i) => {
    const w = wanted[index.get(m.author)];
    if (!w.size) return;
    grams(m.text, tokenized[i], (key, first, last) => {
      const x = w.get(key);
      if (!x) return;
      const form = m.text.slice(first.s, last.e);
      x.forms.set(form, (x.forms.get(form) || 0) + 1);
      if (m.text.length >= form.length + 8 && m.text.length <= 160) x.examples.push(m.text);
    });
  });
  for (const w of wanted) {
    for (const { t, forms, examples } of w.values()) {
      let text = [...forms].sort((x, y) => y[1] - x[1])[0][0];
      if (/^\p{Lu}[\p{Ll}' ]/u.test(text) && text !== text.toUpperCase()) text = text[0].toLowerCase() + text.slice(1);
      t.text = text.replace(/\s+/g, ' ');
      t.example = examples.length ? shuffle(examples)[0] : null;
    }
  }

  const authors = names
    .map((name, a) => ({
      name,
      messages: perAll[a],
      tics: picked[a].map(({ text, kind, uses, others, topOther, lift, example = null, file = null, of = null }) =>
        ({ text, kind, uses, others, topOther, lift: Math.round(lift * 10) / 10, example, file, of })),
      photos: shuffle(photos[a]).slice(0, 40),
      photoCount: photos[a].length,
      stats: records.get(name) || null,
    }))
    .sort((x, y) => y.messages - x.messages);

  const slideshow = files.size ? bestPhotos(chat, files) : [];
  return { title: chat.title, messageCount: M + medias.length, withMedia: files.size > 0, level, authors, slideshow };
}
