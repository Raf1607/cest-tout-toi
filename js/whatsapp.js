// Lecture d'un export de discussion WhatsApp (« Exporter la discussion », sans médias).
// Formats reconnus :
//   iPhone   [27/10/2026 14:32:05] Julie Moreau: message
//   Android  27/10/2026 14:32 - Julie Moreau: message
// ainsi que leurs variantes (« à », virgule, AM/PM, dates à l'américaine).

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
  /^<[^<>]*>$/,                                    // <Médias omis>, <Media omitted>, <pièce jointe : …>
  /^(?:ce message a été supprimé|vous avez supprimé ce message|message supprimé|this message was deleted|you deleted this message|null)$/i,
  /\((?:fichier joint|file attached)\)$/i,
  /^(?:image|vidéo|video|audio|gif|autocollant|sticker|document|photo|contact|carte de contact)\s+(?:absente?|omise?|omis|omitted|retirée?|retiré)$/i,
];

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
    if (/^[‎‏]/.test(text)) continue;    // iPhone : médias et messages système commencent par une marque invisible
    const author = rest.slice(0, colon).replace(MARKS, '').replace(/^~\s*/, '').trim();
    if (!author) continue;
    current = { author, text, day: m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[4]}-${m[5]}-${m[6]}` };
    parsed.push(current);
  }

  const messages = [];
  const counts = new Map();
  for (const msg of parsed) {
    const text = msg.text.replace(MARKS, '').replace(/[  ]/g, ' ').replace(EDITED, '').trim();
    if (!text || SKIP.some(re => re.test(text))) continue;
    messages.push({ author: msg.author, text, day: msg.day });
    counts.set(msg.author, (counts.get(msg.author) || 0) + 1);
  }

  const authors = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return { title: chatTitle(fileName), messages, authors };
}
