// Génère des discussions WhatsApp factices (5 amis, chacun avec ses tics, ses stickers et ses GIF)
// dans samples/ : export Android et iPhone sans médias, et export iPhone avec médias (.zip).
//   node tools/make-sample.mjs
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';

let seed = 42;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const chance = p => rnd() < p;

const BASE = [
  'on se retrouve où ce soir', 'je suis au boulot jusqu\'à 19h', 'vous avez vu le match hier', 'il fait un temps pourri',
  'qui vient samedi', 'je ramène les bières', 'j\'ai beaucoup de taf cette semaine', 'c\'était vraiment cool hier',
  'je pars en vacances la semaine pro', 'le resto était bon', 'je suis en retard désolé', 'on part à quelle heure',
  'j\'ai vu un film incroyable', 'ça marche pour moi', 'je peux pas ce weekend', 'envoyez les photos', 'c\'est quoi le plan',
  'j\'arrive dans 10 min', 'on fait un apéro jeudi', 'il reste de la place dans la voiture', 'la flemme', 'je suis crevé',
  'quelqu\'un a un chargeur', 'on réserve où', 'je vous rejoins plus tard', 'vous êtes où', 'c\'est réglé',
  'on peut décaler à 21h', 'j\'ai raté le train', 'qui a les clés', 'je m\'occupe des courses', 'il faut qu\'on s\'organise',
  'j\'ai trouvé une super adresse', 'ça vous dit un ciné', 'je rentre tard ce soir', 'on se fait un foot dimanche',
  'vous avez écouté le nouvel album', 'le concert c\'est quand déjà', 'je suis devant', 'je vous tiens au courant',
  'j\'ai faim', 'qui prend le dessert', 'c\'est mon tour de payer', 'on vote', 'je suis chaud pour samedi',
];

const PEOPLE = [
  { name: 'Julie Moreau', w: 30, tics: [
    s => (chance(0.25) ? 'du coup ' : '') + s, s => s + (chance(0.12) ? ', trop bien' : ''), s => s + (chance(0.3) ? ' 😂' : ''),
    s => (chance(0.13) ? pick(['ahahah', 'ahahahah', 'ahahahahah']) + ' ' : '') + s, s => s + (chance(0.06) ? ' bisous' : ''),
    s => s + (chance(0.05) ? ' avec Léo' : '')] },
  { name: 'Karim B', w: 22, tics: [
    s => (chance(0.2) ? 'wesh ' : '') + s, s => s + (chance(0.12) ? ' frérot' : ''), s => s + (chance(0.15) ? ' de ouf' : ''),
    s => (chance(0.18) ? 'en vrai ' : '') + s, s => s + (chance(0.2) ? ' 🔥' : '')] },
  { name: 'Inès', w: 18, tics: [
    s => (chance(0.15) ? 'carrément, ' : '') + s, s => s + (chance(0.35) ? '...' : ''), s => (chance(0.15) ? 'j\'avoue ' : '') + s,
    s => s + (chance(0.1) ? ' tkt' : ''), s => s + (chance(0.15) ? ' 💀' : '')] },
  { name: 'Thomas Lefèvre', w: 18, tics: [
    s => (chance(0.15) ? 'Bref. ' : '') + s, s => (chance(0.1) ? 'ok ok ' : '') + s, s => s + (chance(0.2) ? pick([' mdrrr', ' mdrrrr', ' mdrr']) : ''),
    s => s + (chance(0.15) ? ' grave' : ''), s => s + (chance(0.25) ? ' !!!' : '')] },
  { name: 'Max', w: 12, tics: [
    s => s + (chance(0.15) ? ', c\'est clair' : ''), s => s + (chance(0.08) ? '. Voilà voilà' : ''), s => s + (chance(0.1) ? ', on verra' : ''),
    s => (chance(0.1) ? 'Hello ' : '') + s, s => s + (chance(0.15) ? ' 🙏' : '')] },
];
const SOPHIE = 'Sophie';   // membre très peu active : ne doit pas être analysée

const cap = s => s[0].toUpperCase() + s.slice(1);
const totalW = PEOPLE.reduce((s, p) => s + p.w, 0);
const who = () => { let r = rnd() * totalW; for (const p of PEOPLE) if ((r -= p.w) < 0) return p; return PEOPLE[0]; };

// Médias : chacun ses habitudes et ses stickers ou GIF fétiches.
const MEDIA = {
  'Julie Moreau': { gif: 0.10, photo: 0.03, favGif: [1, 1, 1, 2] },
  'Karim B': { sticker: 0.18, favSticker: [1, 1, 1, 2, 2] },
  'Inès': { sticker: 0.06, vocal: 0.03, favSticker: [3, 3, 3] },
  'Thomas Lefèvre': { vocal: 0.12, photo: 0.05 },
  'Max': { photo: 0.06, gif: 0.03 },
};
const SHARED_STICKERS = [8, 9];   // stickers que tout le monde envoie de temps en temps
const SHARED_GIFS = [8];

const lines = [];   // {day, minute, author, text} ou {day, minute, author, media: {kind, id}}
let day = new Date(2026, 4, 1);
for (let d = 0; d < 130; d++) {
  day = new Date(day.getTime() + 86400000);
  const burst = chance(0.75) ? 6 + Math.floor(rnd() * 30) : 0;
  let minute = 9 * 60 + Math.floor(rnd() * 600);
  for (let i = 0; i < burst; i++) {
    // Karim relance souvent la conversation du jour ; Max répond quasi instantanément.
    const p = i === 0 && chance(0.5) ? PEOPLE[1] : who();
    minute = Math.min(minute + (p.name === 'Max' ? 0 : 1 + Math.floor(rnd() * 8)), 23 * 60 + 59);
    let s = pick(BASE);
    if (p.name === 'Inès' && chance(0.12)) s = [s, pick(BASE), pick(BASE), pick(BASE), pick(BASE), pick(BASE), pick(BASE), pick(BASE)].join(', ') + ', bref je vous raconterai tout en détail';
    for (const t of p.tics) s = t(s);
    if (chance(0.5)) s = cap(s);
    if (p.name === 'Max' && chance(0.1)) s = s.toUpperCase();   // l'explosif du groupe
    lines.push({ day, minute, author: p.name, text: s });
    const m = MEDIA[p.name];
    for (const kind of ['sticker', 'gif', 'vocal', 'photo']) {
      if (!chance(m[kind] || 0.015)) continue;
      const fav = kind === 'sticker' ? m.favSticker : kind === 'gif' ? m.favGif : null;
      const shared = kind === 'sticker' ? SHARED_STICKERS : SHARED_GIFS;
      const id = kind === 'photo' || kind === 'vocal' ? null : fav && chance(0.8) ? pick(fav) : pick(shared);
      lines.push({ day, minute, author: p.name, media: { kind, id } });
    }
    if (chance(0.01)) lines.push({ day, minute, author: p.name, text: 'DELETED' });
  }
  if (d === 40) for (let i = 0; i < 8; i++) {   // une conversation sur un sujet : ne doit pas ressortir comme tic
    minute += 2;
    lines.push({ day, minute, author: 'Thomas Lefèvre', text: pick(['Le déménagement c\'est samedi', 'Il me faut encore des cartons', 'Qui peut aider pour le déménagement', 'J\'ai plus de cartons', 'Les cartons sont dans le camion']) });
  }
  if (d % 3 === 0) lines.push({ day, minute: 60 + Math.floor(rnd() * 180), author: 'Thomas Lefèvre', text: cap(pick(BASE)) + ' mdrrr' });   // couche-tard
  if (d % 25 === 3) lines.push({ day, minute: minute + 3, author: SOPHIE, text: pick(['Coucou tout le monde', 'Je passe samedi', 'Merci pour hier']) });
  if (d === 12) lines.push({ day, minute: minute + 5, author: 'Max', text: 'Bon je résume pour samedi :\n- Julie les courses\n- Karim la voiture\n- moi le reste' });
}

// Petites images PNG (sans dépendance) : un visage par sticker, un dégradé par photo.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(px(x, y), y * (w * 4 + 1) + 1 + x * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const HUES = [[0, 0, 0], [255, 196, 0], [255, 99, 71], [80, 200, 120], [70, 150, 255], [200, 120, 255], [255, 140, 200], [140, 90, 60], [160, 160, 160], [0, 190, 200]];
function face(id, anim = false) {
  const [r, g, b] = HUES[id % HUES.length];
  return png(128, 128, (x, y) => {
    const dx = x - 64, dy = y - 64, d = Math.hypot(dx, dy);
    if (d > 58) return [0, 0, 0, 0];
    if (Math.hypot(x - 44, y - 50) < 9 || Math.hypot(x - 84, y - 50) < 9) return [20, 20, 30, 255];
    const smile = id % 3 === 0 ? Math.abs(dy - 22) < 4 && Math.abs(dx) < 26 : id % 3 === 1 ? Math.abs(d - 34) < 4 && dy > 12 : Math.hypot(dx, dy - 26) < 10;
    if (smile) return [20, 20, 30, 255];
    return anim ? [255 - r, 255 - g, 255 - b, 255] : [r, g, b, 255];
  });
}
const photo = seed => png(240, 180, (x, y) => [(x + seed * 37) % 256, (y * 2 + seed * 91) % 256, (seed * 53) % 256, 255]);

const pad = n => String(n).padStart(2, '0');
const date = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const time = (m, sec) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}${sec ? ':' + pad(Math.floor(rnd() * 60)) : ''}`;
const stamp = (d, m) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(Math.floor(m / 60) % 24)}-${pad(m % 60)}-00`;

const OMITTED_IOS = { sticker: 'autocollant omis', gif: 'GIF retiré', vocal: 'audio omis', photo: 'image absente' };
const TYPE = { sticker: ['STICKER', 'webp'], gif: ['GIF', 'gif'], vocal: ['AUDIO', 'opus'], photo: ['PHOTO', 'jpg'] };
const android = ['01/05/2026 10:00 - Les messages et les appels sont chiffrés de bout en bout. Personne en dehors de cette discussion ne peut les lire ou les écouter.',
  '01/05/2026 10:00 - Julie Moreau a créé le groupe « Les Potes »'];
const head = ['[01/05/2026 10:00:00] Les Potes: ‎Les messages et les appels sont chiffrés de bout en bout.',
  '[01/05/2026 10:00:00] Julie Moreau: ‎Julie Moreau a créé ce groupe'];
const ios = [...head], iosMedia = [...head];
const dir = mkdtempSync(join(tmpdir(), 'ctt-'));
let seq = 0;
for (const l of lines) {
  const t = time(l.minute, true);
  if (l.media) {
    const { kind, id } = l.media;
    const file = `${String(++seq).padStart(8, '0')}-${TYPE[kind][0]}-${stamp(l.day, l.minute)}.${TYPE[kind][1]}`;
    writeFileSync(join(dir, file), kind === 'sticker' ? face(id) : kind === 'gif' ? face(id + 3, true) : kind === 'photo' ? photo(seq) : Buffer.from(`vocal ${seq}`));
    android.push(`${date(l.day)} ${time(l.minute)} - ${l.author}: <Médias omis>`);
    ios.push(`[${date(l.day)} ${t}] ${l.author}: ‎${OMITTED_IOS[kind]}`);
    iosMedia.push(`[${date(l.day)} ${t}] ${l.author}: ‎<pièce jointe : ${file}>`);
    continue;
  }
  const a = { DELETED: 'Ce message a été supprimé' }[l.text] ?? l.text;
  const i = { DELETED: '‎Ce message a été supprimé.' }[l.text] ?? l.text;
  android.push(`${date(l.day)} ${time(l.minute)} - ${l.author}: ${a}`);
  ios.push(`[${date(l.day)} ${t}] ${l.author}: ${i}`);
  iosMedia.push(`[${date(l.day)} ${t}] ${l.author}: ${i}`);
}

const root = new URL('../samples/', import.meta.url);
writeFileSync(new URL('Discussion WhatsApp avec Les Potes.txt', root), android.join('\n') + '\n');
writeFileSync(new URL('WhatsApp Chat - Les Potes (iPhone).txt', root), ios.join('\n') + '\n');
writeFileSync(join(dir, '_chat.txt'), iosMedia.join('\n') + '\n');
const zipPath = fileURLToPath(new URL('WhatsApp Chat - Les Potes (avec médias).zip', root));
rmSync(zipPath, { force: true });
execFileSync('zip', ['-q', '-r', zipPath, '.'], { cwd: dir });
rmSync(dir, { recursive: true });
console.log(`${lines.length} messages, dont ${seq} médias, écrits dans samples/`);
