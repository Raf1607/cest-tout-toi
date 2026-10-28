// Affiche les tics trouvés dans un export WhatsApp (.txt, ou .zip avec ou sans médias).
//   node tools/check.mjs "samples/Discussion WhatsApp avec Les Potes.txt"
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseChat } from '../js/whatsapp.js';
import { analyze } from '../js/tics.js';
import { readZipExport } from './zip-export.mjs';

const file = process.argv[2];
const t0 = performance.now();
const { text, files } = /\.zip$/i.test(file) ? readZipExport(file) : { text: readFileSync(file, 'utf8'), files: new Map() };
const chat = parseChat(text, basename(file));
const result = analyze(chat, files);
console.log(`« ${result.title} » : ${result.messageCount} messages dont ${chat.medias.length} médias (${files.size} fichiers), ${chat.authors.length} auteurs, ${Math.round(performance.now() - t0)} ms`);
console.log('Auteurs :', chat.authors.map(a => `${a.name} (${a.count})`).join(', '));
for (const a of result.authors) {
  console.log(`\n${a.name} — ${a.messages} messages${a.photos.length ? `, ${a.photos.length} photos` : ''}`);
  for (const t of a.tics) {
    console.log(`  ${t.kind.padEnd(8)} « ${t.text} »${t.file ? ` [${t.file}]` : ''}  ${t.uses} fois, autres ${t.others}, x${t.lift}${t.topOther ? ` (puis ${t.topOther.name} ${t.topOther.uses})` : ''}`);
    if (t.example) console.log(`           ex : ${t.example.replace(/\n/g, ' / ')}`);
  }
}
