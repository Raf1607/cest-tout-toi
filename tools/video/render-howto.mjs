// Fabrique les tutoriels animés « exporter puis importer » (iPhone et Android, FR et EN)
// à partir de howto.html : chaque image est capturée par Chrome, ffmpeg assemble le tout,
// en 720×1280 sans son (la vidéo tourne en boucle, muette, dans l'écran « Comment ça marche ? »).
//   node tools/video/render-howto.mjs                       (les quatre vidéos, dans video/)
//   node tools/video/render-howto.mjs --only iphone-fr       (une seule)
//   node tools/video/render-howto.mjs --stills 2,6,14 --only android-fr   (images fixes, pour vérifier)
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import ffmpeg from 'ffmpeg-static';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const stills = opt('--stills')?.split(',').map(Number);
const only = opt('--only');
const FPS = 30;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

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

const jobs = ['iphone', 'android'].flatMap(os => ['fr', 'en'].map(lang => ({ os, lang, name: `${os}-${lang}` })))
  .filter(j => !only || j.name === only);

for (const { os, lang, name } of jobs) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  await page.goto(`${base}/tools/video/howto.html?os=${os}&lang=${lang}`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  const duration = await page.evaluate(() => window.DURATION);

  if (stills) {
    await mkdir(join(ROOT, 'promo', 'stills'), { recursive: true });
    for (const t of stills) {
      await page.evaluate(x => window.renderAt(x), t);
      await page.screenshot({ path: join(ROOT, 'promo', 'stills', `howto-${name}-t${t}.jpg`), type: 'jpeg', quality: 70 });
    }
    console.log(`Images fixes ${name} dans promo/stills`);
    await page.close();
    continue;
  }

  const out = join(ROOT, 'video', `howto-${name}.mp4`);
  const enc = spawn(ffmpeg, [
    '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-vf', 'scale=720:1280:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p',
    '-r', String(FPS), '-an', '-movflags', '+faststart', out,
  ], { stdio: ['pipe', 'ignore', 'inherit'] });
  const frames = Math.round(duration * FPS);
  for (let i = 0; i < frames; i++) {
    await page.evaluate(t => window.renderAt(t), i / FPS);
    const img = await page.screenshot({ type: 'jpeg', quality: 90 });
    if (!enc.stdin.write(img)) await new Promise(r => enc.stdin.once('drain', r));
    if (i % 150 === 0) process.stdout.write(`\r${name} : ${i}/${frames}`);
  }
  enc.stdin.end();
  const code = await new Promise(r => enc.on('close', r));
  if (code) throw new Error(`ffmpeg a échoué (${code})`);
  console.log(`\r${name} : ${out} (${duration.toFixed(1)} s)`);
  await page.close();
}

await browser.close();
server.close();
