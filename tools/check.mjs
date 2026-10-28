// Affiche les tics trouvés dans un export WhatsApp.
//   node tools/check.mjs "samples/Discussion WhatsApp avec Les Potes.txt"
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseChat } from '../js/whatsapp.js';
import { analyze } from '../js/tics.js';

const file = process.argv[2];
const t0 = performance.now();
const chat = parseChat(readFileSync(file, 'utf8'), basename(file));
const result = analyze(chat);
console.log(`« ${result.title} » : ${result.messageCount} messages, ${chat.authors.length} auteurs, ${Math.round(performance.now() - t0)} ms`);
console.log('Auteurs :', chat.authors.map(a => `${a.name} (${a.count})`).join(', '));
for (const a of result.authors) {
  console.log(`\n${a.name} — ${a.messages} messages`);
  for (const t of a.tics) {
    console.log(`  ${t.kind.padEnd(5)} « ${t.text} »  ${t.uses} fois, autres ${t.others}, x${t.lift}${t.topOther ? ` (puis ${t.topOther.name} ${t.topOther.uses})` : ''}`);
    if (t.example) console.log(`        ex : ${t.example.replace(/\n/g, ' / ')}`);
  }
}
