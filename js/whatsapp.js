// Lecture d'un export de discussion WhatsApp (« Exporter la discussion », avec ou sans médias).
// Formats reconnus :
//   iPhone   [27/10/2026 14:32:05] Julie Moreau: message
//   Android  27/10/2026 14:32 - Julie Moreau: message
// ainsi que leurs variantes (« à », virgule, AM/PM, dates à l'américaine).
// Les médias deviennent des entrées à part : { author, kind, file, day }, où file est le nom
// du fichier joint dans l'export avec médias (null dans un export sans médias).

const SP = '[ \\u00a0\\u202f]';
const DATE = '(\\d{1,4})[/.\\-](\\d{1,2})[/.\\-](\\d{1,4})';
const TIME = `\\d{1,2}[:.h]\\d{2}(?:[:.]\\d{2})?(?:${SP}?[AaPp]\\.?${SP}?[Mm]\\.?)?`;
const SEP = `(?:,|${SP}à)?${SP}+`;
const HEADER = new RegExp(
  `^(?:\\[${DATE}${SEP}${TIME}\\]${SP}*|${DATE}${SEP}${TIME}${SP}+[-–]${SP}+)`
);

const MARKS = /[‎‏‪-‮⁦-⁩﻿]/g;
const LEADING_MARKS = /^[‎‏‪-‮⁦-⁩﻿]+/;
const EDITED = /\s*<[^<>]*(?:modifié|edited)[^<>]*>\s*$/i;
const SKIP = [
  /^<[^<>]*>$/,
  /^(?:ce message a été supprimé|vous avez supprimé ce message|message supprimé|this message was deleted|you deleted this message|null)$/i,
];

// Médias
const ATTACHED = /^<[^:<>]+:\s*([^<>]+\.\w{2,5})\s*>$/;                       // iPhone : <pièce jointe : 00000012-STICKER-….webp>
const FILE_ATTACHED = /^(\S+\.\w{2,5})\s*\((?:fichier joint|file attached)\)/i; // Android : STK-20240501-WA0003.webp (fichier joint)
const OMITTED = /^(image|photo|vidéo|video|audio|autocollant|sticker|gif|document)\s+(?:absente?|omise?|omis|omitted|retirée?)\.?$/i;
const MEDIA_OMITTED = /^<(?:médias omis|media omitted)>$/i;                     // Android sans médias : type inconnu
const OMITTED_KIND = { image: 'photo', photo: 'photo', vidéo: 'video', video: 'video', audio: 'vocal', autocollant: 'sticker', sticker: 'sticker', gif: 'gif', document: 'doc' };

export function kindFromFile(file) {
  const f = file.toUpperCase();
  if (/STICKER|^STK-/.test(f)) return 'sticker';
  if (/-GIF-/.test(f)) return 'gif';
  if (/PHOTO|^IMG-/.test(f)) return 'photo';
  if (/VIDEO|^VID-/.test(f)) return 'video';
  if (/AUDIO|^PTT-|^AUD-/.test(f)) return 'vocal';
  return 'doc';
}

function mediaOf(text) {
  let m;
  if ((m = ATTACHED.exec(text)) || (m = FILE_ATTACHED.exec(text))) return { kind: kindFromFile(m[1]), file: m[1].trim() };
  if ((m = OMITTED.exec(text))) return { kind: OMITTED_KIND[m[1].toLowerCase()], file: null };
  if (MEDIA_OMITTED.test(text)) return { kind: 'media', file: null };
  return null;
}

export function chatTitle(fileName) {
  const m = /whatsapp.*?(?:avec|with|-)\s+(.+?)(?:\.(?:txt|zip))?$/i.exec(fileName || '');
  return m ? m[1].trim() : '';
}

export function parseChat(raw, fileName = '') {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const parsed = [];
  let current = null;

  for (const line of lines) {
    const bare = line.replace(LEADING_MARKS, '');
    const m = HEADER.exec(bare);
    if (!m) {
      if (current) current.text += '\n' + line;   // suite d'un message sur plusieurs lignes
      continue;
    }
    current = null;
    const rest = bare.slice(m[0].length);
    const colon = rest.indexOf(': ');
    if (colon <= 0) continue;                      // message système Android (« X a ajouté Y »)
    const text = rest.slice(colon + 2);
    const author = rest.slice(0, colon).replace(MARKS, '').replace(/^~\s*/, '').trim();
    if (!author) continue;
    // iPhone : médias et messages système commencent par une marque invisible
    current = { author, text, day: m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[4]}-${m[5]}-${m[6]}`, marked: /^[‎‏]/.test(text) };
    parsed.push(current);
  }

  const messages = [];
  const medias = [];
  const counts = new Map();
  for (const msg of parsed) {
    const text = msg.text.replace(MARKS, '').replace(/[  ]/g, ' ').replace(EDITED, '').trim();
    const media = mediaOf(text.split('\n')[0]);
    if (media) {
      medias.push({ author: msg.author, day: msg.day, ...media });
    } else {
      if (msg.marked || !text || SKIP.some(re => re.test(text))) continue;
      messages.push({ author: msg.author, text, day: msg.day });
    }
    counts.set(msg.author, (counts.get(msg.author) || 0) + 1);
  }

  const authors = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return { title: chatTitle(fileName), messages, medias, authors };
}
