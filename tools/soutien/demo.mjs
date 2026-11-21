// Démo locale du soutien de fin de partie, sans compte Stripe : sert le site tel quel, avec une
// configuration de test (fausse clé, faux Stripe.js, faux Worker). Le site lui-même n'a aucune
// interface réservée au local : sans clé, le soutien est coupé partout.
//   node tools/soutien/demo.mjs        puis http://localhost:8795
// Pour essayer un échec ou une annulation : localStorage['fake-stripe'] = 'fail' | 'cancel' | 'nowallet'.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = Number(process.env.PORT || 8795);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.json': 'application/json' };
export const DEMO_SUPPORT = `export const STRIPE_PK = 'pk_test_demo';
export const PAY_WORKER = '/__demo-pay';
export const STRIPE_JS = '/tools/soutien/fake-stripe.js';
export const SUPPORT_ENABLED = true;
`;

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/__demo-pay/intent' && req.method === 'POST') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ clientSecret: 'pi_demo_secret_demo' }));
  }
  if (path === '/js/support.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(DEMO_SUPPORT); }
  try {
    const file = normalize(join(ROOT, path === '/' ? 'index.html' : path));
    if (!file.startsWith(ROOT)) throw new Error();
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, () => console.log(`Démo du soutien : http://localhost:${PORT}`));
