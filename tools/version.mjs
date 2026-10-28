// Change la version des scripts dans index.html (à lancer avant chaque publication),
// pour que les téléphones téléchargent la nouvelle version au lieu de garder l'ancienne en cache.
//   node tools/version.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../index.html', import.meta.url);
const d = new Date(), pad = n => String(n).padStart(2, '0');
const v = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
writeFileSync(file, readFileSync(file, 'utf8').replace(/\?v=\d+/g, `?v=${v}`));
console.log(`Version des scripts : ${v}`);
