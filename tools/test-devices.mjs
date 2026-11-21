// Parties complètes entre téléphones simulés, sur les trois moteurs de navigateur :
// WebKit (Safari, et tous les navigateurs d'iPhone), Chromium (Chrome, Samsung Internet sur Android)
// et Gecko (Firefox). Chaque appareil a l'écran, le zoom, le tactile et la langue d'un vrai téléphone.
// Vérifie à chaque écran : pas d'erreur JavaScript, pas de débordement horizontal, médias chargés.
//
//   npx playwright install chromium webkit firefox   (une fois)
//   node tools/test-devices.mjs            → captures dans /tmp/whoisbro-devices
//   node tools/test-devices.mjs --headed   → on voit les fenêtres
import { chromium, webkit, firefox, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.env.OUT || '/tmp/whoisbro-devices';
const headless = !process.argv.includes('--headed');
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.zip': 'application/zip', '.txt': 'text/plain', '.mp4': 'video/mp4', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
await mkdir(OUT, { recursive: true });

const engines = { chromium, webkit, firefox };
const FIREFOX_ANDROID = {
  viewport: { width: 360, height: 760 }, deviceScaleFactor: 3, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
};
const device = (label, name) => ({ label, engine: name === 'firefox' ? 'firefox' : devices[name].defaultBrowserType,
  options: name === 'firefox' ? FIREFOX_ANDROID : devices[name] });

const SCENARIOS = [
  { name: 'fr-iphone-hote', locale: 'fr-FR', zip: 'WhatsApp Chat - Les Potes (avec médias).zip', reload: true,
    players: [device('iPhone SE', 'iPhone SE'), device('Pixel 7', 'Pixel 7'), device('Firefox Android', 'firefox')] },
  { name: 'en-android-hote', locale: 'en-US', zip: 'WhatsApp Chat - The Crew (with media).zip', outsider: 2,
    players: [device('Galaxy S9+', 'Galaxy S9+'), device('iPhone 15 Pro Max', 'iPhone 15 Pro Max'), device('Galaxy Tab S9', 'Galaxy Tab S9')] },
  { name: 'fr-txt-ipad', locale: 'fr-FR', zip: 'WhatsApp Chat - Les Potes (iPhone).txt', rounds: 10, quitFromLobby: true,
    players: [device('iPad Mini', 'iPad Mini'), device('Galaxy A55', 'Galaxy A55')] },
];

const problems = [];
const report = (who, msg) => { problems.push(`${who} : ${msg}`); console.log(`  ✗ ${new Date().toISOString().slice(17, 23)} ${who} : ${msg}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(browsers, d, locale, scenario) {
  browsers[d.engine] ||= await engines[d.engine].launch({ headless });
  const context = await browsers[d.engine].newContext({ ...d.options, locale });
  const page = await context.newPage();
  const who = `${scenario} / ${d.label}`;
  page.on('pageerror', e => report(who, 'erreur JS : ' + e.message + (process.env.STACK ? ' @ ' + (e.stack || '').split('\n').slice(0, 4).join(' / ') : '')));
  page.on('console', m => { if (m.type() === 'error' && !/peerjs|Could not connect|ERR_|favicon|Failed to load resource|Wake Lock/i.test(m.text())) report(who, 'console : ' + m.text()); });
  return { page, context, who, label: d.label, seen: new Set() };
}

const screenOf = p => p.page.evaluate(() => document.querySelector('#app')?.dataset.screen || '');

// Débordement horizontal, et éléments visibles qui dépassent de l'écran.
async function inspect(p, tag) {
  const out = await p.page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const wide = document.documentElement.scrollWidth > w + 1;
    const over = [];
    for (const el of document.querySelectorAll('#app *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || getComputedStyle(el).visibility === 'hidden') continue;
      if (el.closest('.slideshow, .edit, .wheel-box, [data-slides]')) continue;
      if (r.right > w + 1 || r.left < -1) over.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} (${Math.round(r.left)}→${Math.round(r.right)} / ${w})`);
    }
    const broken = [...document.querySelectorAll('#app img')].filter(i => i.complete && i.src && !i.naturalWidth).map(i => i.src.slice(0, 60));
    return { wide, over: over.slice(0, 4), broken };
  });
  if (out.wide) report(p.who, `${tag} : la page défile horizontalement`);
  if (out.over.length) report(p.who, `${tag} : dépasse de l'écran → ${out.over.join(', ')}`);
  if (out.broken.length) report(p.who, `${tag} : image cassée ${out.broken.join(', ')}`);
}

async function snap(p, tag, scenario) {
  if (p.seen.has(tag)) return;
  p.seen.add(tag);
  await inspect(p, tag);
  await p.page.screenshot({ path: `${OUT}/${scenario}--${p.label.replace(/\W+/g, '-')}--${tag}.png` });
}

async function play(sc) {
  console.log(`\n▶ ${sc.name} (${sc.players.map(d => d.label).join(', ')})`);
  const browsers = {};
  const ps = [];
  try {
    for (const d of sc.players) ps.push(await open(browsers, d, sc.locale, sc.name));
    const [host, ...guests] = ps;

    // Accueil sur tous les appareils, puis l'hôte importe la discussion.
    for (const p of ps) { await p.page.goto(BASE); await snap(p, 'accueil', sc.name); }
    await host.page.setInputFiles('input[data-input="file"]', join(ROOT, 'samples', sc.zip));
    // Le code n'est jamais affiché : il est dans le lien du QR code (les invités « scannent » ce lien).
    await host.page.waitForSelector('.qr[data-code]', { timeout: 60000 });
    const code = await host.page.getAttribute('.qr[data-code]', 'data-code');
    console.log(`  code ${code}`);
    await host.page.click('[data-act="set"][data-key="rounds"][data-value="10"]');
    await host.page.click('[data-act="set"][data-key="seconds"][data-value="15"]');

    // Les invités suivent le lien, donnent leur prénom ; l'hôte les accepte.
    for (const [i, g] of guests.entries()) {
      await g.page.goto(`${BASE}?p=${code}`);
      await g.page.fill('input[name="name"]', `Joueur ${i + 1}`);
      await g.page.click('form.join button[type="submit"]');
      await host.page.click('[data-act="admit"][data-ok="1"]', { timeout: 60000 });
      await g.page.waitForSelector('.members', { timeout: 60000 });
    }
    // Chacun choisit un membre différent (et, selon le scénario, un joueur n'est pas dans la discussion).
    for (const [i, p] of ps.entries()) {
      if (i === sc.outsider) {
        await p.page.click('[data-act="outside"]');
        await p.page.click('form.outside-form button[type="submit"]');   // prénom déjà rempli
      } else {
        await p.page.locator('.members button:not([disabled])').nth(i).click();
      }
      await p.page.waitForSelector('.me-pick', { timeout: 20000 });
    }
    for (const p of ps) await snap(p, 'salon', sc.name);
    await host.page.waitForSelector('[data-act="start"]:not([disabled])', { timeout: 20000 });
    await host.page.click('[data-act="start"]');

    // La partie : chacun vote au hasard, l'hôte passe à la suite.
    const deadline = Date.now() + 6 * 60 * 1000;
    let reloaded = false, lastRound = 0;
    while (Date.now() < deadline) {
      const screens = await Promise.all(ps.map(screenOf));
      if (screens.every(s => s === 'end')) break;
      for (const [i, p] of ps.entries()) {
        const s = screens[i];
        if (s === 'question') {
          const n = await p.page.evaluate(() => document.querySelector('.hud span')?.textContent || '');
          await snap(p, 'question', sc.name);
          const options = p.page.locator('.options button:not(.on)');
          const voted = await p.page.locator('.options button.on').count();
          if (!voted && await options.count()) {
            await options.nth(Math.floor(Math.random() * await options.count())).click().catch(() => {});
          }
          if (p === host) lastRound = parseInt(n.match(/\d+/)?.[0] || lastRound, 10);
          if (p.seen.has('question') && await p.page.locator('.bubble img, .bubble video').count()) await snap(p, 'question-media', sc.name);
        } else if (s && s !== 'lobby') await snap(p, s, sc.name);
      }
      if (screens[0] === 'reveal') {
        // Un rechargement de la page par l'hôte au milieu de la partie : tout doit reprendre.
        if (sc.reload && !reloaded && lastRound >= 2) {
          reloaded = true;
          console.log('  l\'hôte recharge sa page');
          await host.page.reload();
          await host.page.waitForFunction(() => ['reveal', 'ranking', 'question'].includes(document.querySelector('#app')?.dataset.screen), null, { timeout: 90000 })
            .catch(() => report(host.who, 'la partie ne reprend pas après rechargement'));
          await sleep(4000);
          for (const g of guests) {
            const s = await screenOf(g);
            if (!['reveal', 'ranking', 'question', 'wheel'].includes(s)) report(g.who, `après rechargement de l'hôte, écran « ${s} »`);
          }
        }
        await host.page.click('[data-act="next"]', { timeout: 5000 }).catch(() => {});
      }
      await sleep(400);
    }
    const final = await Promise.all(ps.map(screenOf));
    final.forEach((s, i) => { if (s !== 'end') report(ps[i].who, `pas arrivé au classement final (écran « ${s} »)`); });
    await sleep(3000);   // laisse arriver les photos du diaporama
    for (const p of ps) {
      p.seen.delete('end');
      if (await screenOf(p) === 'end') await snap(p, 'end', sc.name);
      const slides = await p.page.locator('[data-slides] img').count();
      const ranked = await p.page.locator('.ranking li').count();
      console.log(`  ${p.label} : ${ranked} au classement, ${slides} photo(s) dans le diaporama, écrans vus : ${[...p.seen].join(' ')}`);
      if (ranked !== ps.length) report(p.who, `${ranked} joueurs au classement au lieu de ${ps.length}`);
    }
    const [host2, ...guests2] = ps;
    if (sc.quitFromLobby) {
      // L'hôte relance, puis quitte depuis le salon (après confirmation) : les invités reviennent à l'accueil, prévenus.
      await host2.page.click('[data-act="replay"]');
      await host2.page.waitForSelector('.qr[data-code]', { timeout: 10000 });
      host2.page.once('dialog', d => d.accept());
      await host2.page.click('[data-act="home"]');
      await host2.page.waitForSelector('[data-act="privacy"]', { timeout: 10000 });
      for (const g of guests2) {
        await g.page.waitForSelector('.notice', { timeout: 10000 }).catch(() => report(g.who, "pas prévenu que l'hôte a quitté"));
        if (await screenOf(g) !== 'home') report(g.who, `après le départ de l'hôte, écran « ${await screenOf(g)} »`);
      }
    } else {
      // Retour à l'accueil depuis le classement final, pour chacun.
      for (const p of ps) {
        if (process.env.STACK) console.log('  clic accueil', p.label, new Date().toISOString().slice(17, 23));
        await p.page.click('[data-act="home"]');
        await p.page.waitForSelector('[data-act="privacy"]', { timeout: 10000 }).catch(() => report(p.who, "pas de retour à l'accueil"));
      }
    }
  } catch (e) {
    report(sc.name, 'arrêt : ' + e.message.split('\n')[0]);
    for (const p of ps) await p.page.screenshot({ path: `${OUT}/${sc.name}--${p.label.replace(/\W+/g, '-')}--ERREUR.png` }).catch(() => {});
  } finally {
    for (const b of Object.values(browsers)) await b.close();
  }
}

// Les pages annexes, sur un petit et un grand écran de chaque moteur.
async function pages() {
  console.log('\n▶ pages annexes');
  const browsers = {};
  const list = [device('iPhone SE', 'iPhone SE'), device('Galaxy S9+', 'Galaxy S9+'), device('Firefox Android', 'firefox'), device('iPad Mini', 'iPad Mini')];
  for (const d of list) {
    const p = await open(browsers, d, 'fr-FR', 'pages');
    for (const url of ['confidentialite.html', 'privacy.html', 'qui-sommes-nous.html', 'about.html', '?lang=en']) {
      await p.page.goto(BASE + url);
      await p.page.waitForLoadState('load');
      await sleep(800);
      const w = await p.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      if (w) report(p.who, `${url} défile horizontalement`);
      await p.page.screenshot({ path: `${OUT}/pages--${d.label.replace(/\W+/g, '-')}--${url.replace(/\W+/g, '')}.png`, fullPage: true });
    }
    await p.context.close();
  }
  for (const b of Object.values(browsers)) await b.close();
}

for (const sc of SCENARIOS) if (!only || sc.name === only) await play(sc);
if (!only || only === 'pages') await pages();
server.close();
console.log(problems.length ? `\n${problems.length} problème(s) :\n- ${problems.join('\n- ')}` : '\nAucun problème.');
console.log(`Captures : ${OUT}`);
process.exit(problems.length ? 1 : 0);
