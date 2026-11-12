// Fabrique la vidéo de présentation (MP4 vertical 1080×1920, 30 i/s) à partir de promo.html :
// la musique phonk du jeu est rendue hors temps réel, chaque image est capturée par Chrome,
// ffmpeg assemble le tout.
//   npm install            (une fois : puppeteer-core et ffmpeg-static)
//   node tools/video/render.mjs [sortie.mp4]
//   node tools/video/render.mjs --lang en            (version anglaise)
//   node tools/video/render.mjs --stills 1.5,5,9   (images fixes à ces instants, pour vérifier)
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import ffmpeg from 'ffmpeg-static';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const LANG = opt('--lang') === 'en' ? 'en' : 'fr';
const stills = opt('--stills');
const stillsAt = stills ? stills.split(',').map(Number) : null;
const OUT = args[0] || join(ROOT, 'promo', LANG === 'en' ? 'who-is-bro-9x16-en.mp4' : 'who-is-bro-9x16.mp4');
const FPS = 30;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Petit serveur local : la page importe js/phonk.js, ce que file:// interdit.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.includes('..')) throw new Error();
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
await page.goto(`${base}/tools/video/promo.html?lang=${LANG}`, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const duration = await page.evaluate(() => window.DURATION);

if (stillsAt) {
  await mkdir(join(ROOT, 'promo', 'stills'), { recursive: true });
  for (const t of stillsAt) {
    await page.evaluate(x => window.renderAt(x), t);
    await page.screenshot({ path: join(ROOT, 'promo', 'stills', `${LANG}-t${t}.jpg`), type: 'jpeg', quality: 80 });
  }
  await browser.close();
  server.close();
  console.log('Images fixes dans promo/stills');
  process.exit(0);
}

// Musique : AudioBuffer → WAV 16 bits.
await mkdir(dirname(OUT), { recursive: true });
const wav = join(dirname(OUT), `musique-${LANG}.wav`);
const b64 = await page.evaluate(async seconds => {
  const { renderPhonk } = await import('/js/phonk.js');
  const buf = await renderPhonk(seconds);
  const n = buf.length, ch = buf.numberOfChannels, rate = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVEfmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) out.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 0x7fff, true);
  let s = ''; const bytes = new Uint8Array(out.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}, duration);
await writeFile(wav, Buffer.from(b64, 'base64'));

// Images → ffmpeg.
const enc = spawn(ffmpeg, [
  '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-i', wav,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT,
], { stdio: ['pipe', 'ignore', 'inherit'] });
const frames = Math.round(duration * FPS);
for (let i = 0; i < frames; i++) {
  await page.evaluate(t => window.renderAt(t), i / FPS);
  const img = await page.screenshot({ type: 'jpeg', quality: 92 });
  if (!enc.stdin.write(img)) await new Promise(r => enc.stdin.once('drain', r));
  if (i % 150 === 0) process.stdout.write(`\rImages : ${i}/${frames}`);
}
enc.stdin.end();
const code = await new Promise(r => enc.on('close', r));
await browser.close();
server.close();
if (code) throw new Error(`ffmpeg a échoué (${code})`);
console.log(`\rVidéo : ${OUT} (${duration.toFixed(1)} s, ${frames} images)`);
