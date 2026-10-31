// Écrans du jeu. Le même code sert l'hôte (qui tient la partie dans `game`) et les invités
// (qui reçoivent leur vue de la partie par `client`) : chaque écran se dessine à partir de `view`.
/* global qrcode, NoSleep */
import { parseChat } from './whatsapp.js';
import { analyze } from './tics.js';
import { Game, ROUNDS, SECONDS } from './game.js';
import { openRoom, Client } from './net.js';
import { readExport, mediaBlob, toChunks, MediaInbox } from './media.js';

const $app = document.getElementById('app');
const params = new URLSearchParams(location.search);

// Identité du joueur, propre à l'onglet : un rechargement de page rejoint la partie sous le même nom.
const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* navigation privée */ } },
};
const myId = store.get('ctt-id') || (() => {
  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  store.set('ctt-id', id);
  return id;
})();

let ui = { screen: 'home', error: '', busy: '', status: 'ok' };
let view = null;
let game = null;
let client = null;
let endsAt = 0;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n.toLocaleString('fr-FR');
const send = msg => (game ? game.handle(myId, msg) : client?.send(msg));
// Ouverte sur l'ordinateur qui fait tourner serve.py, la page connaît l'adresse du jeu sur le
// Wi-Fi : c'est elle qu'on donne aux téléphones (localhost ne mènerait nulle part).
let lanUrl = null;
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  fetch('lan.json').then(r => (r.ok ? r.json() : null)).then(d => {
    lanUrl = d?.url || null;
    if (lanUrl && ui.screen === 'home') render();
  }).catch(() => { /* servi par un autre serveur */ });
}
const inviteUrl = code => `${lanUrl || location.origin + location.pathname}?p=${code}`;

function qrSvg(text) {
  if (typeof qrcode !== 'function') return '';
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
const nameOf = p => p.author || 'Nouveau joueur';

// Stickers, GIF et photos à montrer : id (nom du fichier dans l'export) → adresse locale de l'image.
const mediaCache = new Map();
function mediaArrived(id) {
  if (view?.phase === 'end') {
    if (!$app.querySelector('[data-slides] .slide')) mountSlides();   // première photo arrivée
    return;
  }
  if (view?.round?.media?.id !== id) return;
  $app.dataset.key = '';   // redessine l'écran avec l'image
  render();
}

// ——— Hôte ———

async function host(getFile) {
  setUi({ screen: 'busy', busy: 'Lecture de la discussion…', error: '' });
  try {
    const file = await getFile();
    const { text, files, entries } = await readExport(file);
    const chat = parseChat(text, file.name);
    if (chat.messages.length < 50) throw new Error('Ce fichier ne ressemble pas à un export de discussion WhatsApp, ou la discussion est trop courte.');
    setUi({ busy: `Analyse de ${fmt(chat.messages.length + chat.medias.length)} messages${files.size ? ` et ${fmt(files.size)} médias` : ''}…` });
    await new Promise(r => setTimeout(r, 50));
    const analysis = analyze(chat, files);
    analysis.title ||= 'la discussion';
    const withTics = analysis.authors.filter(a => a.tics.length);
    if (withTics.length < 2) {
      // Les chiffres aident à comprendre : export mal lu, ou groupe où personne ne se distingue.
      throw new Error(`Pas assez de tics trouvés pour jouer : ${fmt(chat.messages.length)} messages lus, `
        + `${analysis.authors.length} membres avec au moins 20 messages, ${withTics.length} avec des tics `
        + `(${withTics.map(a => a.name).join(', ') || 'aucun'}).`);
    }
    setUi({ busy: 'Création de la partie…' });
    const conns = new Map();
    // Le média de la manche est préparé une fois, puis envoyé à chaque téléphone (et à ceux qui
    // arrivent ou se reconnectent en cours de manche). Celui de la manche suivante part en avance.
    const shared = new Map();   // id → morceaux prêts à envoyer, ou null pendant la préparation
    const sendChunks = (conn, chunks) => { for (const c of chunks) if (conn.open) conn.send(c); };
    async function share(tic) {
      const id = tic?.file;
      if (!id || shared.has(id) || !entries.has(id)) return;
      shared.set(id, null);
      try {
        const blob = await mediaBlob(entries.get(id), id, tic.kind === 'photo');
        mediaCache.set(id, URL.createObjectURL(blob));
        mediaArrived(id);
        const chunks = await toChunks(id, blob);
        shared.set(id, chunks);
        for (const conn of conns.values()) sendChunks(conn, chunks);
      } catch (err) {
        console.warn('Média illisible', id, err);
      }
    }
    async function shareRound() {
      if (game.phase === 'end') {
        for (const slide of game.slides()) await share({ file: slide.id, kind: 'photo' });   // une à une, pour ne pas saturer
        return;
      }
      if (game.phase !== 'question' && game.phase !== 'reveal') return;
      share(game.round.card.tic);
      if (game.phase === 'reveal') share(game.deck[game.index + 1]?.tic);
    }
    const room = await openRoom(conn => {
      let pid = null;
      conn.on('data', msg => {
        if (msg?.t === 'hello' && typeof msg.id === 'string') {
          pid = msg.id.slice(0, 40);
          const old = conns.get(pid);
          conns.set(pid, conn);
          if (old && old !== conn) old.close();
          game.join(pid);
          const current = game.round && shared.get(game.round.card.tic.file);
          if (current && game.phase !== 'lobby' && game.phase !== 'end') sendChunks(conn, current);
          if (game.phase === 'end') for (const slide of game.slides()) if (shared.get(slide.id)) sendChunks(conn, shared.get(slide.id));
        } else if (pid) game.handle(pid, msg);
      });
      conn.on('close', () => { if (pid && conns.get(pid) === conn) { conns.delete(pid); game.leave(pid); } });
    });
    game = new Game(analysis, room.code, myId, () => {
      for (const [pid, conn] of conns) if (conn.open) conn.send({ t: 'state', s: game.view(pid) });
      show(game.view(myId));
      shareRound();
    });
    window.addEventListener('beforeunload', e => { e.preventDefault(); e.returnValue = ''; });
    ui.screen = 'game';
    show(game.view(myId));
  } catch (err) {
    console.error(err);
    setUi({ screen: 'home', error: err.message });
  }
}

// ——— Invité ———

function join(code) {
  code = code.toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) return setUi({ error: 'Le code de la partie fait 4 lettres.' });
  if (params.get('p') !== code) history.replaceState(null, '', `?p=${code}`);
  setUi({ screen: 'busy', busy: `Connexion à la partie ${code}…`, error: '' });
  client?.close();
  const inbox = new MediaInbox((id, url) => { mediaCache.set(id, url); mediaArrived(id); });
  client = new Client(code, myId, {
    onMessage(msg) {
      if (msg?.t === 'state') { ui.screen = 'game'; show(msg.s); }
      else if (msg?.t === 'media') inbox.add(msg);
    },
    onStatus(status) {
      const errors = {
        notfound: `Partie ${code} introuvable. Vérifie le code.`,
        offline: 'Impossible de joindre le serveur de mise en relation. Vérifie la connexion internet.',
        gone: "La connexion avec l'hôte est perdue.",
      };
      if (errors[status]) {
        client = null;
        view = null;
        history.replaceState(null, '', location.pathname);
        setUi({ screen: 'home', error: errors[status], status: 'ok' });
      } else setUi({ status });
    },
  });
}

// ——— Affichage ———

function setUi(patch) { Object.assign(ui, patch); render(); }

function show(v) {
  const before = view;
  view = v;
  const fresh = v.phase === 'question' && (before?.phase !== 'question' || before.round.n !== v.round.n);
  if (fresh && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(40);
  endsAt = v.phase === 'question' ? Date.now() + v.round.remaining : 0;   // l'hôte peut raccourcir le temps
  render();
}

function render() {
  // Pendant une manche, les votes arrivent en continu : on met à jour les boutons sans les
  // redessiner, pour qu'un toucher en cours ne soit pas perdu.
  const key = ui.screen === 'game' && view.phase === 'question' ? `${view.round.n}/${ui.status}` : '';
  if (key && $app.dataset.key === key) { patchQuestion(); tick(); return; }
  let html;
  if (ui.screen === 'home') html = homeScreen();
  else if (ui.screen === 'busy') html = `<div class="busy"><div class="spinner"></div><p>${esc(ui.busy)}</p></div>`;
  else html = { lobby: lobbyScreen, question: questionScreen, reveal: revealScreen, end: endScreen }[view.phase]();
  const banner = ui.status === 'lost' ? '<div class="banner">Connexion perdue, reconnexion…</div>' : '';
  $app.innerHTML = banner + html;
  $app.dataset.screen = ui.screen === 'game' ? view.phase : ui.screen;
  $app.dataset.key = key;
  if (key) patchQuestion();
  if (ui.screen === 'game' && view.phase === 'lobby') rankMemo = { n: 0, before: [], after: [], played: true };
  if (ui.screen === 'game' && view.phase === 'reveal') animateRanks();
  if (ui.screen === 'game' && view.phase === 'end') mountSlides();
  else { clearInterval(slideTimer); slideTimer = null; }
  tick();
}

function homeScreen() {
  const code = params.get('p') || '';
  return `
    <header class="brand">
      <h1>Who is <span>bro</span>&nbsp;?</h1>
      <p>Le jeu qui démasque les tics de langage de votre groupe WhatsApp.</p>
    </header>
    ${ui.error ? `<p class="error">${esc(ui.error)}</p>` : ''}
    ${lanUrl ? `
    <section class="card invite">
      <div class="qr">${qrSvg(lanUrl)}</div>
      <div>
        <h2>Sur les téléphones</h2>
        <p>Connectés au même Wi-Fi que cet ordinateur, scannez ce code ou ouvrez&nbsp;:</p>
        <p class="url">${esc(lanUrl)}</p>
      </div>
    </section>` : ''}
    <section class="card">
      <h2>Rejoindre une partie</h2>
      <form class="join" data-form="join">
        <input name="code" value="${esc(code)}" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Code de la partie">
        <button class="primary" type="submit">Rejoindre</button>
      </form>
    </section>
    <section class="card">
      <h2>Créer une partie</h2>
      <p>Importe l'export de la discussion du groupe. Elle est analysée sur ce téléphone et n'est envoyée à aucun serveur&nbsp;: les autres joueurs ne reçoivent que ce qu'il faut deviner (expressions, quelques vrais messages, stickers…).</p>
      <label class="button primary file">Importer la discussion<input type="file" accept=".txt,.zip,text/plain,application/zip" data-input="file"></label>
      <details>
        <summary>Comment exporter la discussion&nbsp;?</summary>
        <p><b>iPhone</b> — ouvre la discussion, touche le nom du groupe en haut, puis <i>Exporter la discussion</i> › <i>Joindre les médias</i> (ou <i>Sans médias</i>) › <i>Enregistrer dans Fichiers</i>. Reviens ici et choisis le fichier.</p>
        <p><b>Android</b> — ouvre la discussion, menu ⋮ › <i>Plus</i> › <i>Exporter la discussion</i> › <i>Inclure les médias</i> (ou <i>Sans médias</i>), et enregistre le fichier sur le téléphone.</p>
        <p><b>Avec les médias</b>, le jeu montre aussi les stickers et GIF fétiches de chacun (et, si l'hôte l'active, des photos). Le fichier est plus gros et ne garde que les messages les plus récents. Sans médias, il y a quand même des questions du genre « qui envoie le plus de stickers ».</p>
      </details>
      <button class="link" data-act="demo">Essayer avec une discussion d'exemple</button>
    </section>`;
}

function playerList(v) {
  return `<ul class="players">${v.players.map(p => `
    <li class="${p.connected ? '' : 'off'}">
      <span class="name">${esc(nameOf(p))}${p.id === v.me ? ' <small>(toi)</small>' : ''}</span>
      ${p.host ? '<small class="tag">hôte</small>' : ''}
      ${p.connected ? '' : '<small class="tag">déconnecté</small>'}
    </li>`).join('')}</ul>`;
}

function segmented(name, values, current, label) {
  return `<div class="seg" role="group" aria-label="${label}">${values.map(x =>
    `<button data-act="set" data-key="${name}" data-value="${x}" class="${x === current ? 'on' : ''}">${name === 'seconds' ? x + ' s' : x}</button>`).join('')}</div>`;
}

function lobbyScreen() {
  const v = view;
  const me = v.players.find(p => p.id === v.me);
  const taken = new Map(v.players.filter(p => p.author).map(p => [p.author, p]));
  const canShare = navigator.share || navigator.clipboard;   // absents en http sur le réseau local
  return `
    <div class="top"><span class="title">« ${esc(v.title)} »</span></div>
    <section class="card invite">
      ${v.host ? `<div class="qr">${qrSvg(inviteUrl(v.code))}</div>` : ''}
      <div>
        <p class="label">Code de la partie</p>
        <p class="code">${esc(v.code)}</p>
        ${v.host ? (canShare ? '<button class="small" data-act="share">Partager le lien</button>' : `<p class="url">${esc(inviteUrl(v.code))}</p>`) : ''}
      </div>
    </section>

    <h2>Qui es-tu dans la discussion&nbsp;?</h2>
    <div class="members">${v.members.map(m => {
      const owner = taken.get(m.name);
      const mine = owner?.id === v.me;
      const busy = owner && !mine && owner.connected;
      return `<button data-act="claim" data-author="${esc(m.name)}" class="${mine ? 'on' : ''}" ${busy ? 'disabled' : ''}>
        <span>${esc(m.name)}</span>
        <small>${busy ? 'déjà pris' : `${fmt(m.messages)} messages${m.tics ? '' : ' · aucun tic'}`}</small>
      </button>`;
    }).join('')}</div>

    <h2>Joueurs <small>${v.players.filter(p => p.connected).length}</small></h2>
    ${playerList(v)}

    ${v.host ? `
      <h2>Réglages</h2>
      <div class="setting"><span>Manches</span>${segmented('rounds', ROUNDS, v.settings.rounds, 'Nombre de manches')}</div>
      <div class="setting"><span>Temps pour voter</span>${segmented('seconds', SECONDS, v.settings.seconds, 'Temps pour voter')}</div>
      <label class="setting toggle">
        <span>Inclure les membres absents${v.absentCount ? ` <small>(${v.absentCount})</small>` : ''}</span>
        <input type="checkbox" data-input="absent" ${v.settings.absent ? 'checked' : ''}>
      </label>
      ${v.photoCount ? `
      <label class="setting toggle">
        <span>Questions sur les photos <small>(n'importe quelle photo du groupe peut s'afficher)</small></span>
        <input type="checkbox" data-input="photos" ${v.settings.photos ? 'checked' : ''}>
      </label>` : ''}
      ${v.slideCount ? `
      <label class="setting toggle">
        <span>Diaporama des photos à la fin <small>(les ${v.slideCount} photos qui ont le plus fait réagir le groupe)</small></span>
        <input type="checkbox" data-input="slideshow" ${v.settings.slideshow ? 'checked' : ''}>
      </label>` : ''}
      <div class="actions">
        <button class="primary big" data-act="start" ${v.canStart.ok ? '' : 'disabled'}>Lancer la partie</button>
        ${v.canStart.ok ? '' : `<p class="hint">${esc(v.canStart.reason)}</p>`}
      </div>`
    : `<p class="wait">${me?.author ? "L'hôte va lancer la partie…" : 'Choisis ton nom dans la liste.'}</p>`}`;
}

const ASK = {
  expr: 'Qui dit tout le temps…', mot: 'Qui dit tout le temps…', emoji: 'Qui envoie tout le temps…', ponct: 'Qui écrit tout le temps…',
  sticker: 'Qui envoie tout le temps ce sticker ?', gif: 'Qui envoie tout le temps ce GIF ?', photo: 'Qui a envoyé cette photo ?',
  habitude: 'Qui envoie le plus…', record: 'Qui…', favori: 'Qui a cet emoji préféré ?',
  debut: 'Qui commence souvent ses messages par…', fin: 'Qui finit souvent ses messages par…',
  message: 'Qui a écrit ça ?', culte: 'Qui a écrit ce message culte ?',
};

function bubble(r) {
  if (r.media) {
    const url = mediaCache.get(r.media.id);
    const inner = !url ? '<span class="wait">Chargement…</span>'
      : r.media.type === 'video' ? `<video src="${url}" autoplay loop muted playsinline></video>`
      : `<img src="${url}" alt="">`;
    return `<div class="bubble media ${r.kind}">${inner}</div>`;
  }
  if (r.kind === 'habitude') return `<div class="bubble habitude">de ${esc(r.text)}&nbsp;?</div>`;
  if (r.kind === 'record') return `<div class="bubble record">${esc(r.text)}&nbsp;?</div>`;
  if (r.kind === 'favori') return `<div class="bubble emoji">${esc(r.text)}</div>`;
  if (r.kind === 'message' || r.kind === 'culte') return `<div class="bubble message">${esc(r.text)}</div>`;
  if (r.kind === 'debut') return `<div class="bubble expr">«&nbsp;${esc(r.text)}…&nbsp;»</div>`;
  if (r.kind === 'fin') return `<div class="bubble expr">«&nbsp;…${esc(r.text)}&nbsp;»</div>`;
  return `<div class="bubble ${r.kind}">${r.kind === 'expr' || r.kind === 'mot' ? `«&nbsp;${esc(r.text)}&nbsp;»` : esc(r.text)}</div>`;
}

function statLine(r) {
  const others = r.others === 0 ? "Personne d'autre, jamais."
    : `Les autres : ${fmt(r.others)} fois en tout${r.topOther && r.others > r.topOther.uses ? `, dont ${fmt(r.topOther.uses)} pour ${esc(r.topOther.name)}` : r.topOther ? ` (${esc(r.topOther.name)})` : ''}.`;
  if (r.detail) return esc(r.detail);
  if (r.kind === 'photo') return `Une de ses ${fmt(r.uses)} photos.`;
  if (r.kind === 'sticker' || r.kind === 'gif') return `Envoyé <b>${fmt(r.uses)}</b> fois. ${others}`;
  if (r.kind === 'habitude') return `<b>${fmt(r.uses)}</b> ${esc(r.text)} sur ses ${fmt(r.ownerMessages)} messages. ${others}`;
  return `Dans <b>${fmt(r.uses)}</b> de ses ${fmt(r.ownerMessages)} messages. ${others}`;
}

function questionScreen() {
  const r = view.round;
  return `
    <div class="round-top">
      <div class="round-info">
        <div class="hud"><span>Manche ${r.n}/${r.total}</span><span class="timer" data-timer></span></div>
        <div class="bar"><i data-bar></i></div>
      </div>
      <ol class="mini" aria-label="Classement"></ol>
    </div>
    <p class="ask">${ASK[r.kind]}</p>
    ${bubble(r)}
    <div class="options">${r.options.map(name =>
      `<button data-act="vote" data-author="${esc(name)}">${esc(name)}</button>`).join('')}</div>
    <p class="voters"></p>`;
}

// Mon vote, et le petit classement : les points de chacun et qui a déjà voté (pas pour qui).
function patchQuestion() {
  const v = view, r = v.round;
  for (const btn of $app.querySelectorAll('[data-act=vote]')) btn.classList.toggle('on', r.myVote === btn.dataset.author);
  const shown = v.players.filter(p => p.author || p.voted).sort((a, b) => b.score - a.score);
  $app.querySelector('.mini').innerHTML = shown.map(p => `
    <li class="${p.voted ? 'voted' : ''} ${p.connected ? '' : 'off'}">
      <i aria-label="${p.voted ? 'a voté' : 'pas encore voté'}"></i><span>${p.id === v.me ? 'Toi' : esc(nameOf(p).split(' ')[0])}</span><b>${p.score}</b>
    </li>`).join('');
  const present = v.players.filter(p => p.connected);
  const voted = present.filter(p => p.voted).length;
  $app.querySelector('.voters').textContent = voted
    ? `${voted}/${present.length} ont voté · on peut changer d'avis jusqu'à la fin`
    : 'Dès le premier vote, il ne reste que 7 secondes !';
}

function highlight(text, part) {
  const i = text.toLowerCase().indexOf(part.toLowerCase());
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + `<mark>${esc(text.slice(i, i + part.length))}</mark>` + esc(text.slice(i + part.length));
}

// Classement animé : après chaque réponse, chacun glisse de son ancienne place à la nouvelle.
let rankMemo = { n: 0, before: [], after: [], played: true };
function animateRanks() {
  if (rankMemo.played) return;
  rankMemo.played = true;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rows = [...$app.querySelectorAll('.votes li[data-id]')];
  if (rows.length < 2) return;
  const step = rows[1].offsetTop - rows[0].offsetTop;
  const moved = rows.filter(li => {
    const was = rankMemo.before.indexOf(li.dataset.id), now = rankMemo.after.indexOf(li.dataset.id);
    if (was < 0 || was === now) return false;
    li.style.transform = `translateY(${(was - now) * step}px)`;
    li.style.zIndex = was > now ? 2 : 1;      // ceux qui montent passent devant
    return true;
  });
  setTimeout(() => {                          // on laisse d'abord voir la réponse
    for (const li of moved) {
      li.style.transition = 'transform .9s cubic-bezier(.3, 1.3, .5, 1)';
      li.style.transform = '';
    }
  }, 1000);
}

function revealScreen() {
  const v = view, r = v.round;
  const ownerPlayer = v.players.find(p => p.author === r.answer);
  const before = rankMemo.n === r.n ? rankMemo.before : rankMemo.after;
  const place = id => { const i = before.indexOf(id); return i < 0 ? before.length : i; };
  const rows = v.players.filter(p => r.votes[p.id] || p.author).sort((a, b) => b.score - a.score || place(a.id) - place(b.id));
  if (rankMemo.n !== r.n) rankMemo = { n: r.n, before, after: rows.map(p => p.id), played: false };
  return `
    <div class="hud"><span>Manche ${r.n}/${r.total}</span></div>
    ${bubble(r)}
    <p class="answer">C'est tout <b>${esc(r.answer)}</b>&nbsp;!</p>
    <p class="stat">${statLine(r)}</p>
    ${r.example ? `<figure class="example"><figcaption>${esc(r.answer)}</figcaption><p>${highlight(r.example, r.text)}</p></figure>` : ''}
    ${ownerPlayer && r.votes[ownerPlayer.id] && r.votes[ownerPlayer.id] !== r.answer ? `<p class="fun">Même ${esc(r.answer)} n'a pas trouvé&nbsp;!</p>` : ''}
    <ul class="votes">
      <li class="head"><span>Joueur</span><span>a voté</span><span>points</span></li>
      ${rows.map(p => {
        const vote = r.votes[p.id];
        const ok = vote === r.answer;
        const delta = r.deltas[p.id] || 0;
        const was = before.indexOf(p.id), now = rows.indexOf(p);
        const trend = was < 0 || was === now ? '' : was > now ? '<u class="up">▲</u>' : '<u class="down">▼</u>';
        return `<li data-id="${esc(p.id)}" class="${vote ? (ok ? 'ok' : 'ko') : 'none'} ${p.connected ? '' : 'off'}">
          <span class="name"><em>${now + 1}</em>${trend}${esc(nameOf(p))}${p.id === v.me ? ' <small>(toi)</small>' : ''}</span>
          <span class="vote">${vote ? esc(vote) : 'pas voté'}</span>
          <span class="pts">${delta ? `<i class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : '−'}${Math.abs(delta)}</i>` : ''}<b>${p.score}</b></span>
        </li>`;
      }).join('')}
    </ul>
    ${v.host
      ? `<div class="actions"><button class="primary big" data-act="next">${r.last ? 'Voir le classement' : 'Manche suivante'}</button></div>`
      : `<p class="wait">En attente de l'hôte…</p>`}`;
}

function endScreen() {
  const v = view;
  const ranking = [...v.players].filter(p => p.author).sort((a, b) => b.score - a.score);
  const rank = p => 1 + ranking.filter(q => q.score > p.score).length;   // ex æquo : même rang
  return `
    ${v.slides?.length ? '<h2>Les moments du groupe</h2><section class="slideshow" data-slides></section>' : ''}
    <header class="brand small"><h1>Classement</h1></header>
    <ol class="ranking">${ranking.map(p => `
      <li class="${rank(p) === 1 ? 'first' : ''}"><i>${rank(p)}</i><span class="name">${esc(p.author)}${p.id === v.me ? ' <small>(toi)</small>' : ''}</span><b>${p.score}</b></li>`).join('')}</ol>
    <h2>Les tics de chacun</h2>
    <div class="portraits">${v.portraits.map(x => `
      <div class="portrait"><b>${esc(x.name)}</b><p>${x.tics.map(t => `<span>${esc(t)}</span>`).join('')}</p></div>`).join('')}</div>
    ${v.host ? '<div class="actions"><button class="primary big" data-act="replay">Rejouer</button></div>' : `<p class="wait">L'hôte peut relancer une partie.</p>`}`;
}

// Diaporama de fin : une photo toutes les 4 secondes, avec les emojis envoyés juste après.
// Chaque téléphone le fait défiler à son rythme ; les photos s'ajoutent à mesure qu'elles arrivent.
let slideIndex = 0, slideTimer = null;
function mountSlides() {
  clearInterval(slideTimer);
  slideTimer = null;
  const box = $app.querySelector('[data-slides]');
  if (!box) return;
  const next = () => {
    const ready = view.slides.filter(s => mediaCache.has(s.id));
    if (!ready.length) { box.innerHTML = '<p class="wait">Chargement des photos…</p>'; return; }
    const s = ready[slideIndex++ % ready.length];
    box.innerHTML = `<figure class="slide">
      <img src="${mediaCache.get(s.id)}" alt="">
      <figcaption>Photo de ${esc(s.author)}</figcaption>
      ${s.emojis.length ? `<div class="reacts">${s.emojis.map((x, i) =>
        `<span style="--i:${i}">${esc(x.e)}${x.n > 1 ? `<small>×${x.n}</small>` : ''}</span>`).join('')}</div>` : ''}
    </figure>`;
  };
  next();
  slideTimer = setInterval(next, 4000);
}

// Compte à rebours : recalculé localement entre deux messages de l'hôte.
function tick() {
  const timer = $app.querySelector('[data-timer]');
  if (!timer || !endsAt) return;
  const left = Math.max(0, endsAt - Date.now());
  timer.textContent = Math.ceil(left / 1000);
  timer.classList.toggle('hurry', left < 5000);
  $app.querySelector('[data-bar]').style.width = `${(100 * left) / (view.round.seconds * 1000)}%`;
}
setInterval(tick, 200);

// L'écran ne doit pas se mettre en veille pendant la partie : la connexion serait coupée.
// NoSleep passe par le verrouillage d'écran du navigateur, ou à défaut par une petite vidéo
// muette en boucle (cas de la page servie en http sur le réseau local). Il faut un geste
// de l'utilisateur pour l'activer : on le fait au premier toucher.
const noSleep = typeof NoSleep === 'function' ? new NoSleep() : null;
let noSleepTried = false;
document.addEventListener('click', () => {
  if (!noSleep || noSleep.isEnabled || noSleepTried) return;
  noSleepTried = true;
  noSleep.enable().then(() => { noSleepTried = false; }, () => { /* refusé par le navigateur : on n'insiste pas */ });
}, true);

// ——— Événements ———

$app.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const { act } = el.dataset;
  if (act === 'demo') {
    const name = 'WhatsApp Chat - Les Potes (avec médias).zip';
    host(() => fetch('samples/' + encodeURIComponent(name)).then(r => r.blob()).then(b => new File([b], name, { type: 'application/zip' })));
  }
  else if (act === 'claim') send({ t: 'claim', author: el.dataset.author });
  else if (act === 'vote') send({ t: 'vote', n: view.round.n, author: el.dataset.author });
  else if (act === 'set') send({ t: 'settings', settings: { [el.dataset.key]: Number(el.dataset.value) } });
  else if (act === 'start' || act === 'next' || act === 'replay') send({ t: act });
  else if (act === 'share') {
    const url = inviteUrl(view.code);
    try {
      if (navigator.share) await navigator.share({ title: 'Who is bro ?', text: `Rejoins la partie ${view.code}`, url });
      else { await navigator.clipboard.writeText(url); el.textContent = 'Lien copié'; }
    } catch { /* partage annulé */ }
  }
});

$app.addEventListener('change', e => {
  const input = e.target.dataset.input;
  if (input === 'file' && e.target.files[0]) { const file = e.target.files[0]; host(async () => file); }
  if (input === 'absent') send({ t: 'settings', settings: { absent: e.target.checked } });
  if (input === 'photos') send({ t: 'settings', settings: { photos: e.target.checked } });
  if (input === 'slideshow') send({ t: 'settings', settings: { slideshow: e.target.checked } });
});

$app.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.dataset.form === 'join') join(new FormData(e.target).get('code') || '');
});

$app.addEventListener('input', e => {
  if (e.target.name === 'code') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
});

if (params.get('p')) join(params.get('p'));
else render();
