// Lit un export WhatsApp en .zip depuis Node (outils et tests) : le texte de la discussion, et
// pour chaque média la même clé que dans le navigateur (taille + CRC, lus dans le sommaire du zip).
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { execFileSync } from 'node:child_process';

// Répertoire central d'un zip : nom, CRC et taille de chaque fichier, sans rien décompresser.
function zipEntries(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const out = [];
  for (let i = 0, p = buf.readUInt32LE(eocd + 16), n = buf.readUInt16LE(eocd + 10); i < n; i++) {
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    out.push({ name: buf.toString('utf8', p + 46, p + 46 + nameLen), crc: buf.readUInt32LE(p + 16), size: buf.readUInt32LE(p + 24) });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

export function readZipExport(file) {
  const entries = zipEntries(readFileSync(file));
  const chat = entries.find(e => /_chat\.txt$/.test(e.name)) || entries.find(e => /\.txt$/i.test(e.name));
  const text = execFileSync('unzip', ['-p', file, chat.name], { encoding: 'utf8', maxBuffer: 1 << 30 });
  const files = new Map();
  for (const e of entries) if (e !== chat && !e.name.endsWith('/')) files.set(basename(e.name), { key: `${e.size}:${e.crc}`, size: e.size });
  return { text, files };
}
