// Génère og.png (aperçu de partage, 1200×630) et apple-touch-icon.png (icône d'écran d'accueil)
// avec Chrome sans fenêtre.
//   node tools/make-og.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = fileURLToPath(new URL('..', import.meta.url));
const shot = (html, out, w, h) => execFileSync(chrome, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  `--window-size=${w},${h}`, '--virtual-time-budget=4000', `--screenshot=${join(root, out)}`, html,
], { stdio: 'ignore' });

shot('file://' + join(root, 'tools/og.html'), 'og.png', 1200, 630);

const dir = mkdtempSync(join(tmpdir(), 'icon-'));
const icon = join(dir, 'icon.html');
writeFileSync(icon, `<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&display=swap" rel="stylesheet">
<style>*{margin:0}html,body{width:180px;height:180px;overflow:hidden;background:#16131d;display:grid;place-items:center}
span{font:800 64px/1 'Bricolage Grotesque',sans-serif;background:#ffcf3f;color:#1e1a10;padding:14px 16px 20px;border-radius:22px;transform:rotate(-4deg)}</style>
</head><body><span>bro</span></body></html>`);
shot('file://' + icon, 'apple-touch-icon.png', 180, 180);
rmSync(dir, { recursive: true });
console.log('og.png et apple-touch-icon.png générés');
