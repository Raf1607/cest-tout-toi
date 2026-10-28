// Génère une discussion WhatsApp factice (5 amis, chacun avec ses tics) dans samples/.
//   node tools/make-sample.mjs
import { writeFileSync } from 'node:fs';

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

const lines = [];   // {d, h, m, author, text, system}
let day = new Date(2026, 4, 1);
for (let d = 0; d < 130; d++) {
  day = new Date(day.getTime() + 86400000);
  const burst = chance(0.75) ? 6 + Math.floor(rnd() * 30) : 0;
  let minute = 9 * 60 + Math.floor(rnd() * 600);
  for (let i = 0; i < burst; i++) {
    minute += 1 + Math.floor(rnd() * 6);
    const p = who();
    let s = pick(BASE);
    for (const t of p.tics) s = t(s);
    if (chance(0.5)) s = cap(s);
    lines.push({ day, minute, author: p.name, text: s });
    if (chance(0.03)) lines.push({ day, minute, author: p.name, text: 'MEDIA' });
    if (chance(0.01)) lines.push({ day, minute, author: p.name, text: 'DELETED' });
  }
  if (d === 40) for (let i = 0; i < 8; i++) {   // une conversation sur un sujet : ne doit pas ressortir comme tic
    minute += 2;
    lines.push({ day, minute, author: 'Thomas Lefèvre', text: pick(['Le déménagement c\'est samedi', 'Il me faut encore des cartons', 'Qui peut aider pour le déménagement', 'J\'ai plus de cartons', 'Les cartons sont dans le camion']) });
  }
  if (d % 25 === 3) lines.push({ day, minute: minute + 3, author: SOPHIE, text: pick(['Coucou tout le monde', 'Je passe samedi', 'Merci pour hier']) });
  if (d === 12) lines.push({ day, minute: minute + 5, author: 'Max', text: 'Bon je résume pour samedi :\n- Julie les courses\n- Karim la voiture\n- moi le reste' });
}

const pad = n => String(n).padStart(2, '0');
const date = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const time = (m, sec) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}${sec ? ':' + pad(Math.floor(rnd() * 60)) : ''}`;

const android = ['01/05/2026 10:00 - Les messages et les appels sont chiffrés de bout en bout. Personne en dehors de cette discussion ne peut les lire ou les écouter.',
  '01/05/2026 10:00 - Julie Moreau a créé le groupe « Les Potes »'];
const ios = ['[01/05/2026 10:00:00] Les Potes: ‎Les messages et les appels sont chiffrés de bout en bout.',
  '[01/05/2026 10:00:00] Julie Moreau: ‎Julie Moreau a créé ce groupe'];
for (const l of lines) {
  const a = { MEDIA: '<Médias omis>', DELETED: 'Ce message a été supprimé' }[l.text] ?? l.text;
  const i = { MEDIA: '‎image absente', DELETED: '‎Ce message a été supprimé.' }[l.text] ?? l.text;
  android.push(`${date(l.day)} ${time(l.minute)} - ${l.author}: ${a}`);
  ios.push(`[${date(l.day)} ${time(l.minute, true)}] ${l.author}: ${i}`);
}

const root = new URL('../samples/', import.meta.url);
writeFileSync(new URL('Discussion WhatsApp avec Les Potes.txt', root), android.join('\n') + '\n');
writeFileSync(new URL('WhatsApp Chat - Les Potes (iPhone).txt', root), ios.join('\n') + '\n');
console.log(`${lines.length} messages écrits dans samples/`);
