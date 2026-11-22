// Écrans du jeu. Le même code sert l'hôte (qui tient la partie dans `game`) et les invités
// (qui reçoivent leur vue de la partie par `client`) : chaque écran se dessine à partir de `view`.
/* global qrcode, NoSleep */
import { parseChat } from './whatsapp.js';
import { analyze } from './tics.js';
import { Game, ROUNDS, SECONDS, WHEEL, WHEEL_SPIN_MS, ROULETTE_MS, PATRON_SPIN_MS, badgeOf } from './game.js';
import { unlockAudio, audioContext, audioRunning, outputLatency, startMusic, BAR, BEAT, firstDrop, STEM_ICONS } from './music.js';
import { openRoom, Client, CODE_LENGTH } from './net.js';
import { readExport, mediaBlob, toChunks, MediaInbox } from './media.js';
import { pickLang, saveLang, tr } from './i18n.js';
import { saveSave, loadSave, pruneSaves, clearSaves } from './resume.js';

const $app = document.getElementById('app');
const params = new URLSearchParams(location.search);

// Identité du joueur, propre à l'onglet : un rechargement de page rejoint la partie sous le même nom.
const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* navigation privée */ } },
  remove(k) { try { sessionStorage.removeItem(k); } catch { /* navigation privée */ } },
};
// Badge de soutien (👑 mécène, 💎 champion diamant) : gardé sur ce téléphone seulement, et pour de bon
// (localStorage). Le plus fort l'emporte.
const myBadge = () => { try { return badgeOf(localStorage.getItem('ctt-badge')); } catch { return null; } };
function saveBadge(b) {
  try { if (b === 'diamond' || !myBadge()) localStorage.setItem('ctt-badge', b); } catch { /* navigation privée : badge pour cette partie seulement */ }
}
const myId = store.get('ctt-id') || (() => {
  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  store.set('ctt-id', id);
  return id;
})();

// Langue : celle de l'accueil (choix du joueur ou du téléphone), puis celle de l'hôte pendant une partie.
let lang = pickLang();
let T = tr(lang);
function setLang(l) {
  lang = l;
  T = tr(l);
  document.documentElement.lang = l;
  document.title = T('title');
}
setLang(lang);

let ui = { screen: 'home', error: '', busy: '', status: 'ok' };
let view = null;
let game = null;
let client = null;
let endsAt = 0;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n.toLocaleString(T('locale'));
const send = msg => (game ? game.handle(myId, msg) : client?.send(msg));
let syncReport = null;
// Heure de l'hôte (référence de la musique de fin) : la sienne pour l'hôte, estimée pour un invité.
const hostNow = () => (game || !client ? performance.now() : client.hostNow());
// Délai (ms, depuis maintenant) jusqu'à un instant donné en heure de l'hôte.
const untilHost = t => t - hostNow();
// Envoi à un invité : un canal qui se ferme (téléphone en veille, départ) peut refuser l'envoi.
const post = (conn, msg) => { try { if (conn.open) conn.send(msg); } catch { /* il se reconnectera */ } };
const inviteUrl = code => `${location.origin + location.pathname}?p=${code}`;

// Compteur de parties, tous joueurs confondus : un service public gratuit (Abacus) garde le total,
// faute de serveur à nous. Il ne reçoit qu'un « +1 », rien sur la partie.
// Le compteur est là tout de suite : ses chiffres défilent comme un panneau de gare (une seconde au moins,
// plus si le service tarde), puis se posent un à un sur le total. Il ne disparaît jamais : si le service
// ne répond pas, on se pose sur le dernier total vu sur ce téléphone, sinon les chiffres continuent
// de défiler et on redemande toutes les quelques secondes.
const COUNTER = 'https://abacus.jasoncameron.dev';
const COUNTER_KEY = 'who-is-bro-raf1607/parties';
const SPIN_MIN = 1000, SPIN_STEP = 70, SETTLE_STEP = 140, COUNTER_TIMEOUT = 6000, COUNTER_RETRY = 4000;
const lastGames = (() => { try { return Number(localStorage.getItem('ctt-games')) || null; } catch { return null; } })();
const games = { value: null, start: performance.now(), settleAt: 0, done: false, raf: 0 };
(function fetchGames() {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), COUNTER_TIMEOUT);
  fetch(`${COUNTER}/get/${COUNTER_KEY}`, { signal: abort.signal }).then(r => (r.ok ? r.json() : null)).then(d => {
    if (!d?.value) throw new Error();
    games.value = d.value;
    try { localStorage.setItem('ctt-games', d.value); } catch { /* navigation privée */ }
  }).catch(() => {
    if (lastGames) games.value = lastGames;
    else setTimeout(fetchGames, COUNTER_RETRY);
  }).finally(() => clearTimeout(timer));
})();

const gamesText = n => n.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US');
// Les cases du panneau : une par chiffre, les espaces et virgules de milliers entre elles.
const flaps = text => [...text].map(c => (/\d/.test(c) ? `<span class="flap">${c}</span>` : `<span class="sep">${c}</span>`)).join('');
function counterHtml() {
  const settled = games.done;
  const text = settled ? gamesText(games.value) : (games.settleAt ? gamesText(games.value) : gamesText(lastGames || 1234));
  if (!settled) startFlaps();
  return `<p class="counter">${icon(ICONS.globe)}<b class="flaps">${flaps(text)}</b> <span class="counter-label">${T('gamesPlayed', settled ? games.value : 2)}</span></p>`;
}
function startFlaps() {
  if (games.raf) return;
  let last = 0;
  const tick = now => {
    games.raf = 0;
    const box = document.querySelector('.counter .flaps');
    if (!box) return;                              // plus à l'écran : on reprendra au prochain affichage
    if (!games.settleAt && games.value && now - games.start >= SPIN_MIN) {
      games.settleAt = now;
      box.innerHTML = flaps(gamesText(games.value));   // la bonne longueur, puis les chiffres se posent
    }
    const final = games.settleAt ? gamesText(games.value).replace(/\D/g, '') : '';
    if (now - last >= SPIN_STEP) {
      last = now;
      [...box.querySelectorAll('.flap')].forEach((flap, i) => {
        const stopped = games.settleAt && now >= games.settleAt + i * SETTLE_STEP;
        const digit = stopped ? final[i] : String(Math.floor(Math.random() * 10));
        if (flap.textContent !== digit) { flap.textContent = digit; flap.classList.remove('flip'); void flap.offsetWidth; flap.classList.add('flip'); }
      });
    }
    const flapCount = box.querySelectorAll('.flap').length;
    if (games.settleAt && now >= games.settleAt + (flapCount - 1) * SETTLE_STEP) {
      games.done = true;
      box.innerHTML = flaps(gamesText(games.value));
      const label = document.querySelector('.counter-label');
      if (label) label.innerHTML = T('gamesPlayed', games.value);
      return;
    }
    games.raf = requestAnimationFrame(tick);
  };
  games.raf = requestAnimationFrame(tick);
}
const countGame = () => {
  if (['localhost', '127.0.0.1'].includes(location.hostname)) return;
  fetch(`${COUNTER}/hit/${COUNTER_KEY}`).catch(() => { /* compteur indisponible */ });
};

function qrSvg(text) {
  if (typeof qrcode !== 'function') return '';
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
const nameOf = p => p.author || p.name || (p.host ? T('hostName') : T('newPlayer'));   // l'hôte n'a pas tapé de prénom

// Stickers, GIF et photos à montrer : id (nom du fichier dans l'export) → adresse locale de l'image.
const mediaCache = new Map();
function mediaArrived(id) {
  if (view?.phase === 'montage' || view?.phase === 'soundson') return;   // le montage pioche dans ce qui est arrivé
  if (view?.phase === 'end' || view?.phase === 'patron') {
    if (!$app.querySelector('[data-slides] .slide')) mountSlides();   // première photo arrivée
    return;
  }
  if (view?.round?.media?.id !== id) return;
  $app.dataset.key = '';   // redessine l'écran avec l'image
  render();
}

// ——— Hôte ———

async function host(getFile) {
  setUi({ screen: 'busy', busy: T('reading'), error: '', notice: '' });
  try {
    const file = await getFile();
    const { text, files, entries } = await readExport(file);
    const chat = parseChat(text, file.name);
    if (chat.messages.length < 50) throw new Error(T('notAChat'));
    setUi({ busy: T('analysing', fmt(chat.messages.length + chat.medias.length), files.size ? fmt(files.size) : 0) });
    await new Promise(r => setTimeout(r, 50));
    const analysis = analyze(chat, files, lang);
    analysis.title ||= T('chatTitle');
    const withTics = analysis.authors.filter(a => a.tics.length);
    if (withTics.length < 2) {
      // Les chiffres aident à comprendre : export mal lu, ou groupe où personne ne se distingue.
      throw new Error(T('notEnough', fmt(chat.messages.length), analysis.authors.length, withTics.length, withTics.map(a => a.name).join(', ')));
    }
    setUi({ busy: T('creating') });
    await launch(analysis, entries, file);
  } catch (err) {
    console.error(err);
    setUi({ screen: 'home', error: err.message });
  }
}

// Ouvre la salle et tient la partie. snap : partie à reprendre après un rechargement de la page.
async function launch(analysis, entries, file, snap = null) {
    const conns = new Map();
    // Le média de la manche est préparé une fois, puis envoyé à chaque téléphone (et à ceux qui
    // arrivent ou se reconnectent en cours de manche). Celui de la manche suivante part en avance.
    const shared = new Map();   // id → morceaux prêts à envoyer, ou null pendant la préparation
    const sendChunks = (conn, chunks) => { for (const c of chunks) post(conn, c); };
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
    // Les médias du montage partent en arrière-plan dès le début de la partie, un par un.
    let montageSent = false;
    async function shareMontage() {
      if (montageSent) return;
      montageSent = true;
      for (const m of game.montageItems()) {
        await share(m);
        await new Promise(r => setTimeout(r, 200));
      }
    }
    async function shareRound() {
      if (game.phase !== 'lobby') shareMontage();
      if (game.phase === 'end' || game.phase === 'patron') {
        for (const slide of game.slides()) await share({ file: slide.id, kind: 'photo' });   // une à une, pour ne pas saturer
        return;
      }
      if (game.phase !== 'question' && game.phase !== 'reveal') return;
      share(game.round.card.tic);
      if (game.phase === 'reveal') share(game.deck[game.index + 1]?.tic);
    }
    // Médias déjà partagés, pour un joueur qui arrive ou revient en cours de partie.
    function catchUp(conn) {
      const current = game.round && shared.get(game.round.card.tic.file);
      if (current && game.phase !== 'lobby' && game.phase !== 'end' && game.phase !== 'patron') sendChunks(conn, current);
      if (game.phase === 'end' || game.phase === 'patron') for (const slide of game.slides()) if (shared.get(slide.id)) sendChunks(conn, shared.get(slide.id));
      if (game.phase !== 'lobby') for (const m of game.montageItems()) if (shared.get(m.file)) sendChunks(conn, shared.get(m.file));
    }
    function turnAway(pid, why) {
      const conn = conns.get(pid);
      conns.delete(pid);
      if (!conn?.open) return;
      post(conn, { t: 'refused', why });
      setTimeout(() => conn.close(), 500);
    }
    const room = await openRoom(conn => {
      let pid = null;
      conn.on('data', msg => {
        // Horloge commune : l'hôte répond tout de suite avec son heure (voir js/clock.js).
        if (msg?.t === 'ping' && typeof msg.a === 'number') return post(conn, { t: 'pong', a: msg.a, h: performance.now() });
        if (msg?.t === 'hello' && typeof msg.id === 'string') {
          pid = msg.id.slice(0, 40);
          const old = conns.get(pid);
          conns.set(pid, conn);
          if (old && old !== conn) old.close();
          const answer = game.request(pid, typeof msg.name === 'string' ? msg.name : '', msg.badge);
          if (answer === 'ok') catchUp(conn);
          else if (answer === 'wait') post(conn, { t: 'wait' });
          else turnAway(pid, answer);
        } else if (pid && game.players.has(pid)) game.handle(pid, msg);   // les téléphones en attente ne peuvent rien faire
      });
      conn.on('close', () => { if (pid && conns.get(pid) === conn) { conns.delete(pid); game.leave(pid); } });
    }, snap?.code);
    const admitted = new Set();
    game = snap ? Game.restore(analysis, snap) : new Game(analysis, room.code, myId, null);
    // La partie est gardée sur ce téléphone (jamais ailleurs) : un rechargement par erreur la reprend.
    store.set('ctt-hosting', '1');
    if (!snap) saveSession(analysis, file);
    let saving = null;
    const persist = () => {
      clearTimeout(saving);
      saving = setTimeout(() => saveSave(`${myId}:state`, game.snapshot()).catch(() => { /* stockage plein : tant pis */ }), 300);
    };
    setInterval(persist, 60000);   // signe de vie : une sauvegarde que plus aucun onglet ne touche sera effacée
    game.onChange = () => {
      for (const [pid, conn] of conns) {
        if (!conn.open || !game.players.has(pid)) continue;     // seuls les joueurs acceptés reçoivent la partie
        if (!admitted.has(pid)) { admitted.add(pid); catchUp(conn); }
        post(conn, { t: 'state', s: game.view(pid) });
      }
      show(game.view(myId));
      shareRound();
      persist();
    };
    game.onAdmit = turnAway;
    if (myBadge()) game.setBadge(myId, myBadge());
    window.addEventListener('beforeunload', confirmUnload);
    endGame = () => { for (const conn of conns.values()) post(conn, { t: 'ended' }); };
    ui.screen = 'game';
    game.changed();
}

// Safari en navigation privée refuse les fichiers dans IndexedDB : on garde alors le contenu brut
// de la discussion (jusqu'à 100 Mo ; au-delà, la partie reprend sans les médias).
const RAW_MAX = 100 * 1024 * 1024;
async function saveSession(analysis, file) {
  const key = `${myId}:session`, value = { analysis, file };
  try { await saveSave(key, value); }
  catch {
    const raw = file && file.size <= RAW_MAX ? { name: file.name, type: file.type, data: await file.arrayBuffer() } : null;
    await saveSave(key, { ...value, file: raw }).catch(err => console.warn('Sauvegarde impossible', err));
  }
}

function confirmUnload(e) { e.preventDefault(); e.returnValue = ''; }
let endGame = null;   // l'hôte prévient les invités que la partie s'arrête

// Retour à l'accueil depuis une partie : on repart d'une page neuve (salle fermée, minuteurs arrêtés).
// L'hôte prévient d'abord les invités et efface sa sauvegarde.
async function leaveGame() {
  saveLang(lang);
  if (game) {
    endGame?.();
    window.removeEventListener('beforeunload', confirmUnload);
    store.remove('ctt-hosting');
    await clearSaves(myId);
    await new Promise(r => setTimeout(r, 300));   // le temps que le message parte
  }
  client?.close();
  location.replace(location.pathname);
}

// Au chargement : l'hôte a rechargé sa page en pleine partie ? On la reprend, avec le même code.
// Sinon (onglet fermé puis rouvert), une ancienne sauvegarde est effacée.
async function resumeHost() {
  setUi({ screen: 'busy', busy: T('resuming') });
  try {
    const session = await loadSave(`${myId}:session`);
    const snap = await loadSave(`${myId}:state`);
    if (!session || !snap || snap.hostId !== myId) throw new Error('nothing');
    const raw = session.file?.data;
    const file = raw ? new File([raw], session.file.name, { type: session.file.type }) : session.file;
    const { entries } = file ? await readExport(file) : { entries: new Map() };
    await launch(session.analysis, entries, file, snap);
  } catch (err) {
    store.remove('ctt-hosting');
    clearSaves(myId);
    setUi({ screen: 'home', error: err.message === 'nothing' ? '' : T('resumeFailed') });
  }
}

// ——— Invité ———

// Le code de la partie n'est jamais affiché : il voyage dans le lien du QR code (…?p=CODE).
const joinCode = () => (params.get('p') || '').toUpperCase().replace(/[^A-Z]/g, '');
function forgetCode() {
  params.delete('p');
  history.replaceState(null, '', location.pathname);
}

function join(code, name = store.get('ctt-name') || '') {
  code = code.toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== CODE_LENGTH) { forgetCode(); return setUi({ screen: 'home', error: T('badCode') }); }
  name = name.trim().slice(0, 24);
  if (!name) return setUi({ screen: 'home', error: T('nameNeeded') });
  store.set('ctt-name', name);
  if (params.get('p') !== code) { params.set('p', code); history.replaceState(null, '', `?p=${code}`); }
  setUi({ screen: 'busy', busy: T('connecting'), error: '', notice: '' });
  client?.close();
  const inbox = new MediaInbox((id, url) => { mediaCache.set(id, url); mediaArrived(id); });
  clearInterval(syncReport);
  // Qualité du calage d'horloge, envoyée à l'hôte de temps en temps : un téléphone mal calé recevra une
  // piste peu rythmique dans la musique de fin.
  syncReport = setInterval(() => { if (client?.clock.ready) client.send({ t: 'sync-quality', ...client.clock.quality() }); }, 10000);
  client = new Client(code, myId, name, {
    badge: myBadge(),
    onMessage(msg) {
      if (msg?.t === 'state') { ui.screen = 'game'; show(msg.s); }
      else if (msg?.t === 'wait') setUi({ screen: 'busy', busy: T('waiting') });
      else if (msg?.t === 'ended' && view?.phase === 'end') {
        // On garde le classement à l'écran. La connexion se ferme d'elle-même quand l'hôte part :
        // la couper tout de suite ferait échouer les photos qu'il est encore en train d'envoyer.
        const done = client;
        client = null;
        setTimeout(() => done.close(), 5000);
      }
      else if (msg?.t === 'refused' || msg?.t === 'ended') {
        client?.close();
        client = null;
        view = null;
        forgetCode();
        if (msg.t === 'ended') setUi({ screen: 'home', status: 'ok', error: '', notice: T('ended') });
        else setUi({ screen: 'home', status: 'ok', error: msg.why === 'closed' ? T('closed') : T('refused') });
      }
      else if (msg?.t === 'media') inbox.add(msg);
    },
    onStatus(status) {
      const errors = {
        notfound: T('notFound'),
        offline: T('offline'),
        gone: T('gone'),
      };
      if (errors[status]) {
        client = null;
        view = null;
        forgetCode();
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
  if (v.phase === 'patron') {
    if (before?.phase !== 'patron' || !ui.patron) ui.patron = { dismissed: false, pay: 'idle', cheerSeen: v.patron.cheer?.seq || 0, showPay: false };
    ui.patron.view = v.patron;
  }
  if (v.lang && v.lang !== lang) setLang(v.lang);   // la partie se joue dans la langue de l'hôte
  const fresh = v.phase === 'question' && (before?.phase !== 'question' || before.round.n !== v.round.n);
  if (fresh && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(40);
  endsAt = v.phase === 'question' ? Date.now() + v.round.remaining : 0;   // l'hôte peut raccourcir le temps
  render();
  syncMusic();
}

function render() {
  // Pendant une manche, les votes arrivent en continu : on met à jour les boutons sans les
  // redessiner, pour qu'un toucher en cours ne soit pas perdu.
  const inGame = ui.screen === 'game';
  const patron = inGame && patronLocal();
  const key = patron ? `patron/${ui.patron.view.step}/${ui.patron.pay === 'thanks' ? 'merci' : ui.patron.showPay ? 'payer' : 'verdict'}`
    : inGame && view.phase === 'question' ? `${view.round.n}/${ui.status}`
    : inGame && view.phase === 'ranking' ? `classement${view.ranking.n}`
    : inGame && view.phase === 'wheel' ? `roue${view.wheel.index}`
    : inGame && view.phase === 'montage' ? 'montage'
    : inGame && view.phase === 'soundson' ? `soundson/${audioRunning() ? 'on' : 'off'}` : '';
  if (key && $app.dataset.key === key) {
    if (patron) patchPatron();          // le bouton de paiement, déjà monté, ne doit pas être redessiné
    else if (view.phase === 'question') { patchQuestion(); tick(); }   // le classement animé, lui, n'est pas interrompu
    return;
  }
  unmountPay?.();
  unmountPay = null;
  boardTimers.forEach(t => (t?.stop ? t.stop() : clearTimeout(t)));
  boardTimers = [];
  let html;
  if (ui.screen === 'home') html = homeScreen();
  else if (ui.screen === 'privacy') html = privacyScreen();
  else if (ui.screen === 'howto') html = howtoScreen();
  else if (ui.screen === 'busy') html = `${client ? homeLogo() : ''}<div class="busy"><div class="spinner"></div><p>${esc(ui.busy)}</p></div>`;
  else if (patron) html = patronScreen();
  else html = { lobby: lobbyScreen, question: questionScreen, reveal: revealScreen, ranking: rankingScreen, wheel: wheelScreen, soundson: soundsOnScreen, montage: montageScreen, end: endScreen, patron: endScreen }[view.phase]();
  const banner = ui.status === 'lost' ? `<div class="banner">${T('lost')}</div>` : '';
  // Un champ du salon en cours de saisie (recherche, prénom) garde le curseur quand l'écran se redessine.
  const typing = document.activeElement?.dataset?.input;
  const caret = typing ? document.activeElement.selectionStart : null;
  $app.innerHTML = banner + html;
  if (view?.phase === 'lobby' && ui.screen === 'game') {
    filterMembers();
    const field = typing && $app.querySelector(`[data-input="${typing}"]`);
    if (field) { field.focus(); try { field.setSelectionRange(caret, caret); } catch { /* champ sans curseur */ } }
  }
  $app.dataset.screen = ui.screen === 'game' ? (patron ? 'patron' : view.phase === 'patron' ? 'end' : view.phase) : ui.screen;
  $app.dataset.key = key;
  if (inGame && view.phase === 'question') patchQuestion();
  if (ui.screen === 'game' && view.phase === 'ranking') animateBoard();
  if (ui.screen === 'game' && view.phase === 'wheel') spinWheel();
  if (ui.screen === 'game' && view.phase === 'soundson') runSoundsOn();
  if (ui.screen === 'game' && view.phase === 'montage') runMontage();
  if (patron) startPatron();
  syncMusic();
  if (ui.screen === 'game' && !patron && (view.phase === 'end' || view.phase === 'patron')) mountSlides();
  else { clearInterval(slideTimer); slideTimer = null; }
  tick();
}

// Petites icônes au trait (couleur du texte).
const icon = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  noUser: '<circle cx="10" cy="8" r="4"/><path d="M2 21a8 8 0 0 1 13-6.2M17 17l4 4M21 17l-4 4"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/>',
  imageOff: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21M2 2l20 20"/>',
};

// Réassurance sur les données, sur l'accueil et à l'arrivée d'un invité : mène à l'explication.
const privacyBadge = () => `<button class="privacy-badge" data-act="privacy">${icon(ICONS.lock)}<span><b>${T('noData')}</b><small>${T('noDataSub')} <u>${T('privacyHow')}</u></small></span>${icon(ICONS.lock)}</button>`;

// Logos officiels d'Apple et d'Android (tracés Simple Icons), pleins.
const OS_LOGOS = {
  apple: 'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701',
  android: 'M18.4395 5.5586c-.675 1.1664-1.352 2.3318-2.0274 3.498-.0366-.0155-.0742-.0286-.1113-.043-1.8249-.6957-3.484-.8-4.42-.787-1.8551.0185-3.3544.4643-4.2597.8203-.084-.1494-1.7526-3.021-2.0215-3.4864a1.1451 1.1451 0 0 0-.1406-.1914c-.3312-.364-.9054-.4859-1.379-.203-.475.282-.7136.9361-.3886 1.5019 1.9466 3.3696-.0966-.2158 1.9473 3.3593.0172.031-.4946.2642-1.3926 1.0177C2.8987 12.176.452 14.772 0 18.9902h24c-.119-1.1108-.3686-2.099-.7461-3.0117-.7438-1.7997-1.8526-3.1724-2.9643-4.1387-.6618-.5752-1.2879-.9881-1.8155-1.2827-.0153-.0085.0028-.0083 1.9434-3.3696.4232-.7337.1062-1.3814-.3242-1.6504-.4304-.2689-1.1162-.2723-1.5528.0068zM8.9453 13.4648c.5307.0017.9573.4304.957.961.0016.5341-.4304.9673-.9622.9658-.5317-.0016-.9606-.4339-.9606-.9658.0004-.53.4306-.9603.9606-.961zm6.1094 0c.53.0007.9604.431.9607.961 0 .5319-.4289.9642-.9607.9658-.5318.0015-.9638-.4317-.9622-.9658-.0003-.5306.4263-.9593.957-.961z',
};
const osLogo = name => `<svg class="os-${name}" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="${OS_LOGOS[name]}"/></svg>`;

// Sélecteur FR / EN, le même en haut de l'accueil, des écrans d'aide et des pages annexes.
const langSwitch = () => `<div class="lang-switch" role="group" aria-label="Langue / Language">${['fr', 'en'].map(l => `<button data-act="lang" data-lang="${l}" lang="${l}" aria-pressed="${l === lang}">${l.toUpperCase()}</button>`).join('')}</div>`;

// Logo en haut des écrans : un toucher ramène à l'accueil (en partie, après confirmation).
const homeLogo = () => `<button class="home-logo" data-act="home" aria-label="${T('home')}">Who is <span>bro</span>&nbsp;?</button>`;

function homeScreen() {
  if (joinCode()) return joinScreen();
  return `<div class="home"><div class="home-top">
    ${langSwitch()}
    <header class="brand">
      <h1>Who is <span>bro</span>&nbsp;?</h1>
      <p>${T('tagline')}</p>
      ${counterHtml()}
    </header>
    ${ui.error ? `<p class="error">${esc(ui.error)}</p>` : ''}
    ${ui.notice ? `<p class="notice">${esc(ui.notice)}</p>` : ''}
    </div>
    <section class="host">
      <label class="button primary big file">${T('import')}<input type="file" accept=".txt,.zip,text/plain,application/zip" data-input="file"></label>
      <p class="hint">${T('importHint')}</p>
    </section>
    <div class="home-bottom">
    <section class="how">
      <p class="how-label">${T('howItWorks')}</p>
      <div class="how-buttons">
        <button data-act="howto" data-os="iphone">${osLogo('apple')}iPhone</button>
        <button data-act="howto" data-os="android">${osLogo('android')}Android</button>
      </div>
      ${privacyBadge()}
    </section>
    <footer class="foot">
      <a href="${T('videoFile')}">${T('video')}</a>
      <a href="${T('aboutPage')}">${T('about')}</a>
    </footer></div></div>`;
}

// Arrivé par le QR code de l'hôte : il ne reste qu'à donner son prénom.
function joinScreen() {
  return `
    ${homeLogo()}
    ${ui.error ? `<p class="error">${esc(ui.error)}</p>` : ''}
    <section class="card">
      <h2>${T('joinTitle')}</h2>
      <form class="join" data-form="join">
        <input name="name" value="${esc(store.get('ctt-name') || '')}" maxlength="24" placeholder="${T('yourName')}" autocomplete="given-name" aria-label="${T('yourName')}">
        <button class="primary" type="submit">${T('join')}</button>
      </form>
    </section>
    ${privacyBadge()}
    <button class="link" data-act="cancel-join">${T('cancel')}</button>`;
}

// « Comment ça marche ? » : la vidéo de l'export puis de l'import, et les étapes écrites.
function howtoScreen() {
  const os = ui.howto === 'android' ? 'android' : 'iphone';
  return `
    ${langSwitch()}
    <div class="sheet-top"><button class="back" data-act="howto-close" aria-label="${T('cancel')}">${icon(ICONS.back)}</button><h1>${T('howtoTitle', os === 'iphone' ? 'iPhone' : 'Android')}</h1></div>
    <video class="howto-video" src="video/howto-${os}-${lang}.mp4" autoplay muted loop playsinline disablepictureinpicture aria-label="${T('howtoVideo')}"></video>
    <ol class="howto-steps">${T('howtoSteps')[os].map(step => `<li>${step}</li>`).join('')}</ol>
    <p class="howto-tip">${T('exportMedia')}</p>
    <div class="actions">
      <label class="button primary big file">${T('import')}<input type="file" accept=".txt,.zip,text/plain,application/zip" data-input="file"></label>
      <button class="link" data-act="howto-close">${T('goBack')}</button>
    </div>`;
}

// « Comment ? » : l'essentiel sur les données en quatre points, le détail sur la page dédiée.
function privacyScreen() {
  const icons = [ICONS.phone, ICONS.chat, ICONS.trash, ICONS.noUser];
  return `
    ${langSwitch()}
    <div class="sheet-top"><button class="back" data-act="privacy-close" aria-label="${T('cancel')}">${icon(ICONS.back)}</button><h1>${T('privacyTitle')}</h1></div>
    <ul class="privacy-points">${T('privacyPoints').map(([title, text], i) => `
      <li>${icon(icons[i])}<div><b>${title}</b><p>${text}</p></div></li>`).join('')}</ul>
    <div class="actions">
      <button class="primary big" data-act="privacy-close">${T('gotIt')}</button>
      <a class="privacy-more" href="${T('privacyPage')}">${T('privacyMore')}</a>
    </div>`;
}

function playerList(v) {
  return `<ul class="players">${v.players.map(p => `
    <li class="${p.connected ? '' : 'off'}">
      <span class="name">${esc(nameOf(p))}${badgeIcon(p.badge)}${p.id === v.me ? ` <small>${T('you')}</small>` : ''}</span>
      ${p.outside ? `<small class="tag">${T('outsideTag')}</small>` : ''}
      ${p.host && (p.author || p.name) ? `<small class="tag">${T('hostTag')}</small>` : ''}
      ${p.connected ? '' : `<small class="tag">${T('offTag')}</small>`}
    </li>`).join('')}</ul>`;
}

function segmented(name, values, current, label) {
  return `<div class="seg" role="group" aria-label="${label}">${values.map(x =>
    `<button data-act="set" data-key="${name}" data-value="${x}" class="${x === current ? 'on' : ''}">${name === 'seconds' ? x + ' s' : x}</button>`).join('')}</div>`;
}

// Choix de son nom dans la discussion. Grand groupe : un champ de recherche, et les membres sans
// question repliés (on peut quand même s'y trouver). Une fois son nom choisi, la liste se replie.
const MANY_MEMBERS = 12;
const fold = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
function memberPicker(v, taken) {
  const many = v.members.length > MANY_MEMBERS;
  const members = [...v.members].sort((a, b) => (b.tics ? 1 : 0) - (a.tics ? 1 : 0));   // tri stable : par messages ensuite
  const minor = members.filter(m => !m.tics).length;
  return `
    ${many ? `<input class="member-search" type="search" data-input="member-search" value="${esc(ui.memberQuery || '')}" placeholder="${T('searchName')}" aria-label="${T('searchName')}" autocomplete="off">` : ''}
    <div class="members">${members.map(m => {
      const owner = taken.get(m.name);
      const mine = owner?.id === v.me;
      const busy = owner && !mine && owner.connected;
      return `<button data-act="claim" data-author="${esc(m.name)}" class="${mine ? 'on' : ''} ${many && !m.tics ? 'minor' : ''}" ${busy ? 'disabled' : ''}>
        <span>${esc(m.name)}</span>
        <small>${busy ? T('taken') : T('messagesCount', fmt(m.messages))}</small>
      </button>`;
    }).join('')}</div>
    ${many && minor ? `<button class="link more-members" data-act="more-members" data-n="${minor}"></button>` : ''}`;
}

// Pas dans la discussion : on joue quand même, sous son prénom (celui tapé pour entrer, déjà rempli).
function outsidePicker(me) {
  if (!ui.outsideForm) return `<button class="link outside-link" data-act="outside">${T('notInChat')}</button>`;
  return `
    <form class="join outside-form" data-form="outside">
      <input name="name" data-input="outside-name" value="${esc(ui.outsideName ?? (me?.name || store.get('ctt-name') || ''))}" maxlength="24" placeholder="${T('yourName')}" autocomplete="given-name" aria-label="${T('yourName')}">
      <button class="primary" type="submit">${T('playAnyway')}</button>
    </form>
    <p class="hint">${T('outsideHint')}</p>`;
}

// Filtre la liste sans la redessiner (pour ne pas perdre la saisie).
function filterMembers() {
  const q = fold((ui.memberQuery || '').trim());
  for (const b of $app.querySelectorAll('.members button')) {
    b.hidden = q ? !fold(b.dataset.author).includes(q) : b.classList.contains('minor') && !ui.allMembers;
  }
  const more = $app.querySelector('.more-members');
  if (more) {
    more.hidden = !!q;
    more.textContent = ui.allMembers ? T('lessMembers') : T('moreMembers', more.dataset.n);
  }
}

function lobbyScreen() {
  const v = view;
  const me = v.players.find(p => p.id === v.me);
  const taken = new Map(v.players.filter(p => p.author).map(p => [p.author, p]));
  return `
    ${homeLogo()}
    <div class="group">
      ${icon(ICONS.chat)}<b>${esc(v.title)}</b>
      <span class="media-ic ${v.withMedia ? '' : 'off'}" role="img" aria-label="${T(v.withMedia ? 'withMedia' : 'withoutMedia')}">${icon(v.withMedia ? ICONS.image : ICONS.imageOff)}</span>
    </div>
    ${v.waiting?.length ? `
    <section class="card knock">
      <h2>${T('knockTitle')}</h2>
      <p class="hint">${T('knockHint')}</p>
      ${v.waiting.map(w => `<div class="ask"><span>${esc(w.name || T('someone'))}</span>
        <button class="small" data-act="admit" data-id="${esc(w.id)}" data-ok="0">${T('refuse')}</button>
        <button class="small primary" data-act="admit" data-id="${esc(w.id)}" data-ok="1">${T('accept')}</button></div>`).join('')}
    </section>` : ''}

    ${v.host ? `
    <section class="card join-qr">
      <div class="qr" data-code="${esc(v.code)}">${qrSvg(inviteUrl(v.code))}</div>
      <p>${T('scanToJoin')}</p>
    </section>` : ''}

    <h2>${T('whoAreYou')}</h2>
    ${(me?.author || me?.outside) && !ui.pickName ? `
    <div class="me-pick"><span>${me.author ? T('youAre', esc(me.author)) : T('youAreOutside', esc(me.name))}</span><button class="link" data-act="change-name">${T('changeName')}</button></div>` : `${memberPicker(v, taken)}${outsidePicker(me)}`}

    <h2>${T('players')} <small>${v.players.filter(p => p.connected).length}</small></h2>
    ${playerList(v)}

    ${v.host ? `
      <h2>${T('settings')}</h2>
      <div class="setting"><span>${T('rounds')}</span>${segmented('rounds', ROUNDS, v.settings.rounds, T('roundsLabel'))}</div>
      <div class="setting"><span>${T('voteTime')}</span>${segmented('seconds', SECONDS, v.settings.seconds, T('voteTime'))}</div>
      <label class="setting toggle">
        <span>${T('absent')}${v.absentCount ? ` <small>(${v.absentCount})</small>` : ''}</span>
        <input type="checkbox" data-input="absent" ${v.settings.absent ? 'checked' : ''}>
      </label>
      <div class="actions">
        <button class="primary big" data-act="start" ${v.canStart.ok ? '' : 'disabled'}>${T('start')}</button>
        ${v.canStart.ok ? '' : `<p class="hint">${esc(T(v.canStart.reason))}</p>`}
      </div>`
    : `<p class="wait">${me?.author || me?.outside ? T('hostWillStart') : T('pickName')}</p>`}`;
}

function bubble(r) {
  if (r.media) {
    const url = mediaCache.get(r.media.id);
    const inner = !url ? `<span class="wait">${T('loading')}</span>`
      : r.media.type === 'video' ? `<video src="${url}" autoplay loop muted playsinline></video>`
      : `<img src="${url}" alt="">`;
    return `<div class="bubble media ${r.kind}">${inner}</div>`;
  }
  if (r.kind === 'habitude') return `<div class="bubble habitude">${T('habitBubble', esc(r.text))}</div>`;
  if (r.kind === 'record') return `<div class="bubble record">${T('recordBubble', esc(r.text))}</div>`;
  if (r.kind === 'favori') return `<div class="bubble emoji">${esc(r.text)}</div>`;
  if (r.kind === 'message' || r.kind === 'culte') return `<div class="bubble message">${esc(r.text)}</div>`;
  if (r.kind === 'debut') return `<div class="bubble expr">${T('quote', `${esc(r.text)}…`)}</div>`;
  if (r.kind === 'fin') return `<div class="bubble expr">${T('quote', `…${esc(r.text)}`)}</div>`;
  return `<div class="bubble ${r.kind}">${r.kind === 'expr' || r.kind === 'mot' ? T('quote', esc(r.text)) : esc(r.text)}</div>`;
}

function statLine(r) {
  const others = r.others === 0 ? T('nobodyElse')
    : T('othersTotal', fmt(r.others), r.topOther && r.others > r.topOther.uses ? T('othersTop', fmt(r.topOther.uses), esc(r.topOther.name)) : r.topOther ? T('othersOne', esc(r.topOther.name)) : '');
  if (r.detail) return esc(r.detail);
  if (r.kind === 'photo') return T('onePhoto', fmt(r.uses));
  if (r.kind === 'sticker' || r.kind === 'gif') return `${T('sentTimes', fmt(r.uses))} ${others}`;
  if (r.kind === 'habitude') return `${T('habitStat', fmt(r.uses), esc(r.text), fmt(r.ownerMessages))} ${others}`;
  return `${T('inMessages', fmt(r.uses), fmt(r.ownerMessages))} ${others}`;
}

// « Manche 4/10 », ou « Question bonus 11/11 » pour la manche ajoutée par la roue.
const roundLabel = r => T(r.bonus ? 'bonusRound' : 'round', r.n, r.total);

function questionScreen() {
  const r = view.round;
  return `
    <div class="round-top">
      <div class="round-info">
        <div class="hud"><span>${roundLabel(r)}</span><span class="timer" data-timer></span></div>
        <div class="bar"><i data-bar></i></div>
      </div>
      <div class="vote-count" aria-live="polite"><b data-voted>0</b><span data-present></span><small>${T('votedLabel')}</small></div>
    </div>
    ${r.boost ? `<p class="fx good">${T(r.boost === 'pouce' ? 'fxPouce' : 'fxRoulette')}</p>` : ''}
    ${r.course ? `<p class="fx good">${T('fxCourse')}</p>` : ''}
    ${r.all ? `<p class="fx good">${T('fxManche')}</p>` : ''}
    ${r.flou ? `<p class="fx bad">${T('fxFlou')}</p>` : ''}
    <p class="ask">${T('ask')[r.kind]}</p>
    ${bubble(r)}
    <div class="options">${r.options.map(name =>
      `<button data-act="vote" data-author="${esc(name)}">${esc(name)}</button>`).join('')}</div>
    <p class="voters"></p>`;
}

// Mon vote, et combien de joueurs ont déjà voté (pas qui, ni pour qui).
function patchQuestion() {
  const v = view, r = v.round;
  for (const btn of $app.querySelectorAll('[data-act=vote]')) btn.classList.toggle('on', r.myVote === btn.dataset.author);
  $app.querySelector('.bubble').classList.toggle('blurred', !!r.blurred);
  const present = v.players.filter(p => p.connected);
  const voted = present.filter(p => p.voted).length;
  $app.querySelector('[data-voted]').textContent = voted;
  $app.querySelector('[data-present]').textContent = `/${present.length}`;
  $app.querySelector('.vote-count').classList.toggle('all', voted === present.length);
  $app.querySelector('.voters').textContent = voted ? T('changeMind') : T('firstVote');
}

function highlight(text, part) {
  const i = text.toLowerCase().indexOf(part.toLowerCase());
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + `<mark>${esc(text.slice(i, i + part.length))}</mark>` + esc(text.slice(i + part.length));
}

// Classement entre deux manches (3 secondes) : chacun part de son ancienne place, les points
// s'ajoutent, puis les joueurs glissent vers leur nouvelle place.
function rankingScreen() {
  const { n, total, rows } = view.ranking;
  const step = Math.min(68, Math.floor((window.innerHeight - 150) / Math.max(rows.length, 1)));
  return `
    <header class="brand small"><h1>${T('ranking')}</h1><p>${T('afterRound', n, total)}</p></header>
    <ol class="board" style="height:${rows.length * step}px">${rows.map((p, now) => `
      <li data-now="${now}" data-was="${p.was}" class="${p.id === view.me ? 'me' : ''} ${p.delta > 0 ? 'gain' : p.delta < 0 ? 'loss' : ''} ${p.was > now ? 'rise' : ''}" style="--i:${p.was};height:${step - 8}px;transform:translateY(${p.was * step}px)">
        <em>${p.was + 1}</em>
        <span class="name">${esc(p.id === view.me ? `${nameOf(p)} ${T('you')}` : nameOf(p))}${badgeIcon(p.badge)}${p.shield ? `<i class="shield" role="img" aria-label="${T('wheel').bouclier}">${icon(ICONS.shield)}</i>` : ''}</span>
        ${p.delta ? `<i class="${p.delta > 0 ? 'up' : 'down'}">${p.delta > 0 ? '+' : '−'}${Math.abs(p.delta)}</i>` : ''}
        <u class="${p.was > now ? 'up' : p.was < now ? 'down' : ''}">${p.was > now ? '▲' : p.was < now ? '▼' : ''}</u>
        <b data-from="${p.score - p.delta}" data-to="${p.score}">${p.score - p.delta}</b>
      </li>`).join('')}</ol>`;
}

// Roue de la fortune : tous les téléphones affichent le même résultat, tiré par l'hôte.
function wheelScreen() {
  const angle = 360 / WHEEL.length;
  const slices = WHEEL.map((s, i) => `var(--${s.kind}${i % 2 ? '-2' : ''}) ${i * angle}deg ${(i + 1) * angle}deg`).join(',');
  return `
    <header class="brand small"><h1>${T('wheelTitle')}</h1></header>
    <div class="wheel-box">
      <div class="lights">${Array.from({ length: 18 }, (_, i) => `<i style="--a:${i * 20}deg;--n:${i % 2}"></i>`).join('')}</div>
      <div class="pointer"></div>
      <div class="wheel" style="background:conic-gradient(${slices})">${WHEEL.map((s, i) =>
        `<span style="transform:rotate(${(i + 0.5) * angle}deg)"><b>${esc(T('wheel')[s.id])}</b></span>`).join('')}</div>
      <div class="spot"></div>
      <div class="hub"></div>
    </div>
    <div class="slot" data-slot hidden><b></b></div>
    <p class="wheel-result" data-result></p>`;
}

function wheelMessage() {
  const w = view.wheel, seg = WHEEL[w.index], who = `<b>${esc(w.target || T('newPlayer'))}</b>`;
  if (w.shielded) return T('wheelShield', who, esc(T('wheel')[seg.id]));
  const msg = T('wheelSays')[seg.id];
  return (typeof msg === 'function' ? msg(who) : msg) + (w.mine && w.names ? `<small>${T('itsYou')}</small>` : '');
}

// Après la roue, pour les cases tirées au hasard : les prénoms défilent comme une machine à sous,
// ralentissent et s'arrêtent sur le joueur choisi.
function rollNames(done) {
  const slot = $app.querySelector('[data-slot]'), label = slot?.querySelector('b');
  const names = view.wheel.names || [];
  if (!slot || !names.length) return done();
  slot.hidden = false;
  let t = 0, i = Math.floor(Math.random() * names.length), step = 60;
  while (t + step < ROULETTE_MS - 1100) {
    const name = names[i++ % names.length];
    boardTimers.push(setTimeout(() => { label.textContent = name; slot.classList.toggle('tick'); }, t));
    t += step;
    step *= 1.12;                       // de plus en plus lent
  }
  boardTimers.push(setTimeout(() => { label.textContent = view.wheel.target; slot.classList.add('stop'); }, t));
  boardTimers.push(setTimeout(done, t + 900));
}

function spinWheel() {
  const wheel = $app.querySelector('.wheel');
  if (!wheel) return;
  const angle = 360 / WHEEL.length;
  const jitter = (Math.random() - 0.5) * angle * 0.7;   // jamais sur la ligne entre deux cases
  const stop = 360 * 6 - (view.wheel.index + 0.5) * angle + jitter;
  const stage = $app.querySelector('.wheel-box');
  boardTimers.push(setTimeout(() => { wheel.style.transform = `rotate(${stop}deg)`; stage.classList.add('spinning'); }, 60));
  boardTimers.push(setTimeout(() => {         // arrêt : la case gagnante s'illumine, puis confettis ou secousse
    const seg = WHEEL[view.wheel.index];
    const box = $app.querySelector('[data-result]');
    stage.classList.remove('spinning');
    stage.classList.add('done', view.wheel.shielded ? 'shield' : seg.kind);
    const announce = () => {
      box.className = `wheel-result show ${view.wheel.shielded ? '' : seg.kind}`;
      box.innerHTML = wheelMessage();
      if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(seg.kind === 'bonus' ? 60 : [60, 50, 60]);
      if (seg.kind === 'bonus' && !view.wheel.shielded) confetti(stage);
    };
    if (view.wheel.names) rollNames(announce);
    else announce();
  }, WHEEL_SPIN_MS));
}

function confetti(parent) {
  const colors = ['#ffcf3f', '#52d18f', '#ff7a6b', '#7fb4ff', '#f5f1e8'];
  for (let i = 0; i < 34; i++) {
    const c = document.createElement('s');
    const a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 130;
    c.style.cssText = `left:50%;top:50%;background:${colors[i % colors.length]};--x:${Math.round(Math.cos(a) * d)}px;--y:${Math.round(Math.sin(a) * d)}px;--r:${Math.round(Math.random() * 720)}deg;animation-delay:${Math.round(Math.random() * 120)}ms`;
    parent.append(c);
  }
}

// ——— Fin de partie en musique ———
// La musique (js/music.js) part au même instant sur tous les téléphones : l'hôte a fixé l'heure de départ
// (view.music.startAt, son horloge), chacun la convertit en temps audio. Les écrans suivent la même horloge :
// passage au montage au début de la mesure 4, une photo par temps au drop.
let music = null;   // { startAt, handle, mine }
function syncMusic() {
  const m = view?.phase === 'soundson' || view?.phase === 'montage' ? view.music : null;
  if (!m || ui.screen !== 'game') {
    if (music) { music.handle?.stop(0.3); music = null; }   // l'hôte a passé, ou c'est fini : fondu partout
    return;
  }
  if (music?.startAt === m.startAt) {
    // Une piste reprise d'un téléphone parti : bascule à la mesure suivante.
    const key = m.mine.join() + m.solo;
    if (music.handle && music.key !== key) {
      const c = audioContext();
      music.handle.setMine(m.mine, c.currentTime + (untilHost(m.startAt + m.from * BAR * 1000)) / 1000);
      music.key = key;
    }
    return;
  }
  if (!audioRunning()) return;                       // son bloqué : bouton « Activer le son »
  const c = audioContext();
  const at = c.currentTime + untilHost(m.startAt) / 1000 - outputLatency();
  music = { startAt: m.startAt, key: m.mine.join() + m.solo, handle: startMusic({ version: m.version, at, mine: m.mine, solo: m.solo }) };
}

const trackName = k => T('tracks')[k] || k;
function soundsOnScreen() {
  const m = view.music;
  const mine = m.solo ? [`${STEM_ICONS.all} ${trackName('all')}`] : m.mine.map(k => `${STEM_ICONS[k]} ${trackName(k)}`);
  return `
    <div class="soundson">
      <div class="speaker" data-pulse><span>🔊</span><i></i><i></i><i></i></div>
      <h1>${T('soundsOn')}</h1>
      <p class="hint">${T('soundsOnHint')}</p>
      <p class="track">${T('yourTrack', mine.join(' · '))}</p>
      ${audioRunning() ? '<p class="countdown" data-count></p>' : `<button class="primary big" data-act="enable-sound">${T('enableSound')}</button>`}
    </div>
    ${view.host ? `<button class="link edit-skip" data-act="skip">${T('skip')}</button>` : ''}`;
}

// Les ondes du haut-parleur battent la mesure ; « 4 3 2 1 » sur les 4 derniers temps avant le montage.
function runSoundsOn() {
  const m = view.music, box = $app.querySelector('[data-pulse]');
  if (box) box.style.animationDelay = `${-(((hostNow() - m.startAt) % (BEAT * 1000)) + BEAT * 1000) % (BEAT * 1000)}ms`;
  const count = $app.querySelector('[data-count]');
  if (!count) return;
  const montageAt = m.startAt + m.prepBars * BAR * 1000;
  for (let n = 4; n >= 1; n--) {
    const delay = untilHost(montageAt - n * BEAT * 1000);
    if (delay < -BEAT * 1000) continue;
    boardTimers.push(setTimeout(() => { count.textContent = n; count.classList.remove('tick'); void count.offsetWidth; count.classList.add('tick'); }, Math.max(0, delay)));
  }
}

// Montage façon edit, calé sur la musique (spec : la meilleure photo tombe pile sur le drop).
//   courte : drop des mesures 4 à 9, une photo par temps (la meilleure d'abord), un sticker tous les 4 temps ;
//   longue : groove (mesures 4 à 7) avec les photos les moins bien classées, une tous les 2 temps, et les
//   messages cultes s'il y en a ; montée (mesure 8) avec un zoom qui s'accélère ; drop des mesures 9 à 14.
//   Dernière mesure : la meilleure photo floutée en fond, « Who is bro ? ».
const CUTS = ['punch', 'shake', 'flash', 'glitch', 'noir', 'tilt', 'slide'];

function montageScreen() {
  return `<div class="edit"><div class="edit-frame" data-frame></div></div>
    ${view.host ? `<button class="link edit-skip" data-act="skip">${T('skip')}</button>` : ''}`;
}

function montagePlan(m, items, quotes) {
  const photos = items.filter(x => x.kind === 'photo'), extras = items.filter(x => x.kind !== 'photo');
  const ranked = photos.length ? photos : items;
  const plan = [];   // { bar, beat, what }
  const drop = firstDrop(m.version);
  if (m.version === 'long') {
    const low = ranked.slice().reverse();
    for (let k = 0; k < 8; k++) {
      const q = k % 2 && quotes.length ? quotes[(k >> 1) % quotes.length] : null;
      plan.push({ bar: 3 + (k >> 1), beat: (k % 2) * 2, what: q ? { quote: q } : { media: low[k % low.length], fx: CUTS[k % CUTS.length] } });
    }
    plan.push({ bar: drop - 1, beat: 0, what: { media: low[7 % low.length] || ranked[0], fx: 'build' } });
  }
  let n = 0, e = 0;
  for (let bar = drop; bar < m.bars - 1; bar++) {
    for (let beat = 0; beat < 4; beat++) {
      const k = (bar - drop) * 4 + beat;
      const sticker = k % 4 === 3 && extras.length;
      plan.push({ bar, beat, what: sticker ? { media: extras[e++ % extras.length], fx: 'punch', sticker: true } : { media: ranked[n++ % ranked.length], fx: k === 0 ? 'drop' : CUTS[k % CUTS.length] } });
    }
  }
  plan.push({ bar: m.bars - 1, beat: 0, what: { outro: ranked[0] } });
  return plan;
}

function runMontage() {
  const frame = $app.querySelector('[data-frame]');
  if (!frame) return;
  const m = view.music, { items, quotes } = view.montage;
  const show = (html, fx, cls = '') => {
    frame.className = `edit-frame ${cls}`;
    frame.innerHTML = html;
    void frame.offsetWidth;                   // relance l'animation même si l'effet est le même
    frame.classList.add(fx);
  };
  const media = x => {
    const url = x && mediaCache.get(x.id);
    if (!url) return '';
    return x.type === 'video' ? `<video src="${url}" autoplay loop muted playsinline></video>` : `<img src="${url}" alt="">`;
  };
  // Un média pas encore arrivé : le suivant de la même sorte qui l'est.
  const ready = (x, sticker) => {
    if (x && mediaCache.has(x.id)) return x;
    return items.find(y => mediaCache.has(y.id) && (y.kind === 'photo') !== !!sticker) || items.find(y => mediaCache.has(y.id));
  };
  const render = what => {
    if (what.quote) return show(`<div class="edit-quote"><p>${esc(what.quote.text)}</p><small>${esc(what.quote.author)}</small></div>`, 'punch');
    if (what.outro) {
      const x = ready(what.outro);
      return show(`${x ? `<div class="edit-bg" style="background-image:url('${mediaCache.get(x.id)}')"></div>` : ''}<p class="edit-text big">${esc(T('montageIntro'))}</p>`, 'fadeout');
    }
    const x = ready(what.media, what.sticker);
    if (x) show(media(x), what.fx, what.sticker || x.kind !== 'photo' ? 'sticker' : '');
  };
  const plan = montagePlan(m, items, quotes);
  const at = p => m.startAt + (p.bar * BAR + p.beat * BEAT) * 1000;
  // Ce qui devrait déjà être à l'écran (arrivée en retard), puis la suite, à l'heure de l'hôte.
  const current = plan.filter(p => untilHost(at(p)) <= 0).pop();
  if (current) render(current.what);
  else show(`<p class="edit-text big">${esc(T('montageIntro'))}</p>`, 'shake');
  for (const p of plan) {
    const delay = untilHost(at(p));
    if (delay > 0) boardTimers.push(setTimeout(() => render(p.what), delay));
  }
}

let boardTimers = [];
function animateBoard() {
  const board = $app.querySelector('.board');
  if (!board) return;
  const rows = [...board.children];
  const step = rows.length > 1 ? parseFloat(rows[0].style.height) + 8 : 0;
  const later = (ms, fn) => boardTimers.push(setTimeout(fn, ms));
  later(350, () => {                          // les points gagnés ou perdus
    board.classList.add('scored');
    for (const li of rows) li.querySelector('b').textContent = li.querySelector('b').dataset.to;
  });
  later(950, () => {                          // puis chacun rejoint sa nouvelle place
    board.classList.add('moving');
    for (const li of rows) {
      li.style.zIndex = +li.dataset.was > +li.dataset.now ? 2 : 1;   // ceux qui montent passent devant
      li.style.transform = `translateY(${li.dataset.now * step}px)`;
      li.querySelector('em').textContent = +li.dataset.now + 1;
    }
  });
  later(1850, () => {                         // le premier brille, et les confettis partent de sa ligne
    rows.find(li => li.dataset.now === '0')?.classList.add('lead');
    const colors = ['#ffcf3f', '#52d18f', '#ff7a6b', '#7fb4ff', '#f5f1e8'];
    for (let i = 0; i < 26; i++) {
      const c = document.createElement('s');
      c.style.cssText = `left:${10 + Math.random() * 80}%;background:${colors[i % colors.length]};--x:${Math.round(Math.random() * 120 - 60)}px;--y:${Math.round(90 + Math.random() * 120)}px;--r:${Math.round(Math.random() * 540)}deg;animation-delay:${Math.round(Math.random() * 180)}ms`;
      board.append(c);
    }
  });
}

function revealScreen() {
  const v = view, r = v.round;
  const ownerPlayer = v.players.find(p => p.author === r.answer);
  const rows = v.players.filter(p => r.votes[p.id] || p.author || p.outside).sort((a, b) => b.score - a.score);
  return `
    <div class="hud"><span>${roundLabel(r)}</span></div>
    ${bubble(r)}
    <p class="answer">${T('answer', esc(r.answer))}</p>
    ${r.racer !== undefined ? `<p class="fx ${r.racer ? 'good' : 'bad'}">${r.racer ? T('courseWon', esc(nameOf(v.players.find(p => p.id === r.racer) || {}))) : T('courseLost')}</p>` : ''}
    <p class="stat">${statLine(r)}</p>
    ${r.example ? `<figure class="example"><figcaption>${esc(r.answer)}</figcaption><p>${highlight(r.example, r.text)}</p></figure>` : ''}
    ${ownerPlayer && r.votes[ownerPlayer.id] && r.votes[ownerPlayer.id] !== r.answer ? `<p class="fun">${T('notEvenOwner', esc(r.answer))}</p>` : ''}
    <ul class="votes">
      <li class="head"><span>${T('colPlayer')}</span><span>${T('colVoted')}</span><span>${T('colPoints')}</span></li>
      ${rows.map(p => {
        const vote = r.votes[p.id];
        const ok = vote === r.answer;
        const delta = r.deltas[p.id] || 0;
        return `<li class="${vote ? (ok ? 'ok' : 'ko') : 'none'} ${p.connected ? '' : 'off'}">
          <span class="name">${esc(nameOf(p))}${p.id === v.me ? ` <small>${T('you')}</small>` : ''}</span>
          <span class="vote">${vote ? esc(vote) : T('noVote')}</span>
          <span class="pts">${delta ? `<i class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : '−'}${Math.abs(delta)}</i>` : ''}<b>${p.score}</b></span>
        </li>`;
      }).join('')}
    </ul>
    ${v.host
      ? `<div class="actions sticky-next"><button class="primary big" data-act="next">${T(r.last ? 'seeResults' : 'nextQuestion')}</button></div>`
      : `<p class="wait">${T('waitHost')}</p>`}`;
}

function endScreen() {
  const v = view;
  const ranking = [...v.players].filter(p => p.author || p.outside).sort((a, b) => b.score - a.score);
  const rank = p => 1 + ranking.filter(q => q.score > p.score).length;   // ex æquo : même rang
  return `
    ${homeLogo()}
    ${v.slides?.length ? `<h2>${T('moments')}</h2><section class="slideshow" data-slides></section>` : ''}
    <header class="brand small"><h1>${T('ranking')}</h1></header>
    <ol class="ranking">${ranking.map(p => `
      <li class="${rank(p) === 1 ? 'first' : ''}"><i>${rank(p)}</i><span class="name">${esc(nameOf(p))}${badgeIcon(p.badge)}${p.id === v.me ? ` <small>${T('you')}</small>` : ''}</span><b>${p.score}</b></li>`).join('')}</ol>
    <button class="big share-game" data-act="share-game">${T('shareGame')}</button>
    <h2>${T('portraits')}</h2>
    <div class="portraits">${v.portraits.map(x => `
      <div class="portrait"><b>${esc(x.name)}</b><p>${x.tics.map(t => `<span>${esc(t)}</span>`).join('')}</p></div>`).join('')}</div>
    <div class="actions">
      ${v.host ? `<button class="primary big" data-act="replay">${T('replay')}</button>` : `<p class="wait">${T('hostCanReplay')}</p>`}
      <button class="big" data-act="home">${T('backHome')}</button>
    </div>`;
}

// ——— Soutien en fin de partie : roue du mécène, paiement, badges ———

const BADGE_ICONS = { crown: '👑', diamond: '💎' };
const badgeLabel = b => T(b === 'diamond' ? 'badgeDiamond' : 'badgeCrown');
const badgeIcon = b => (BADGE_ICONS[b] ? ` <span class="badge-icon" role="img" title="${badgeLabel(b)}" aria-label="${badgeLabel(b)}">${BADGE_ICONS[b]}</span>` : '');
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let unmountPay = null;

// L'écran du mécène reste affiché tant que ce joueur ne l'a pas quitté (« Plus tard », « Continuer »),
// et pendant un paiement ou son merci, même si l'hôte est passé à l'écran de fin entre-temps.
function patronLocal() {
  const P = ui.patron;
  if (!P || P.dismissed || !P.view) return false;
  return view.phase === 'patron' || P.pay === 'paying' || P.pay === 'thanks';
}

const myName = () => { const me = view.players.find(p => p.id === view.me); return me ? nameOf(me) : ''; };
const andList = names => names.length < 2 ? names[0] || '' : `${names.slice(0, -1).join(', ')} ${T('and')} ${names.at(-1)}`;

function patronScreen() {
  const P = ui.patron.view;
  if (ui.patron.pay === 'thanks') return thanksScreen();
  if (P.step === 'spin') {
    const slice = 360 / P.names.length;
    const slices = P.names.map((_, i) => `var(--${i % 2 ? 'patron-2' : 'patron-1'}) ${i * slice}deg ${(i + 1) * slice}deg`).join(',');
    return `
      ${homeLogo()}
      <div class="patron">
        <p class="pill">${T('patronSpin')}</p>
        <div class="wheel-box patron-wheel">
          <div class="lights">${Array.from({ length: 18 }, (_, i) => `<i style="--a:${i * 20}deg;--n:${i % 2}"></i>`).join('')}</div>
          <div class="pointer"></div>
          <div class="wheel" style="background:conic-gradient(${slices})">${P.names.map((n, i) =>
            `<span style="transform:rotate(${(i + 0.5) * slice}deg)"><b>${esc(n)}</b></span>`).join('')}</div>
          <div class="hub"></div>
        </div>
      </div>`;
  }
  const named = P.patron ? `<p class="pill">${T(P.role === 'patron' ? 'patronSpoke' : 'patronNamed', esc(P.patron))}</p>` : '';
  const pay = `<div class="pay" data-pay></div><p class="pay-error" data-pay-error hidden>${T('payFailed')}</p>`;
  const later = `<button class="link" data-act="patron-later">${T('later')}</button>`;
  const banners = '<div class="paid-banners" data-banners></div><div class="cheered" data-cheered hidden></div>';
  if (P.role === 'patron') return `
    ${banners}
    <div class="patron verdict">
      ${named}
      <div class="big-emoji">🫵</div>
      <h1>${T('patronTitle', esc(myName()))}</h1>
      <p class="pitch">${T('pitch1')}</p>
      ${pay}${later}
    </div>`;
  if (P.role === 'champion') return `
    ${banners}
    <div class="patron verdict">
      ${named}
      <div class="big-emoji">🏆</div>
      <h1>${T('champTitle', esc(myName()))}</h1>
      <p class="pitch">${T('pitch2')}</p>
      <p class="nudge" data-nudge hidden></p>
      <p class="tax">${taxLine()}</p>
      <div class="pulse">${pay}</div>${later}
    </div>`;
  const champs = P.champions.map(esc);
  const text = P.patron ? T('freeText', esc(P.patron), andList(champs), champs.length > 1) : T('freeTextChamps', andList(champs), champs.length > 1);
  return `
    ${banners}
    <div class="patron verdict">
      ${named}
      <div class="big-emoji">😮‍💨</div>
      <h1>${T('freeTitle')}</h1>
      <p class="pitch">${text}</p>
      ${P.patron ? `<button class="primary big" data-act="cheer">${T('cheer', esc(P.patron))}</button>` : ''}
      ${ui.patron.showPay ? pay : `<button class="link" data-act="pay-anyway">${T('payAnyway')}</button>`}
      ${later}
    </div>`;
}

// « T'as gagné, alors pour toi c'est plus cher 😂 💸 » : le dernier mot reste collé aux emojis animés.
function taxLine() {
  const words = T('champTax').split(' '), last = words.pop();
  return `<span class="write">${esc(words.join(' '))} <span class="tax-end">${esc(last)} <i class="laugh">😂</i> <i class="bills"><s>💸</s><s>💸</s><s>💸</s></i></span></span>`;
}

function thanksScreen() {
  const b = ui.patron.badge;
  return `
    <div class="patron thanks">
      <div class="rain" data-rain></div>
      <h1>${T(b === 'diamond' ? 'thanks2' : 'thanks1', esc(myName()))}</h1>
      <div class="badge-card ${b}">${BADGE_ICONS[b]} ${badgeLabel(b)}</div>
      <p>${T('badgeKeep')}</p>
      <button class="primary big" data-act="patron-continue">${T('continue')}</button>
    </div>`;
}

// Après chaque rendu de l'écran du mécène : la roue tourne, ou le bouton de paiement se monte.
function startPatron() {
  const P = ui.patron.view;
  if (ui.patron.pay === 'thanks') return rainBills();
  if (P.step === 'spin') {
    const wheel = $app.querySelector('.patron-wheel .wheel'), stage = $app.querySelector('.patron-wheel');
    if (!wheel || P.angle == null) return;
    if (reducedMotion()) { wheel.style.transition = 'none'; wheel.style.transform = `rotate(${P.angle}deg)`; stage.classList.add('done'); return; }
    boardTimers.push(setTimeout(() => { wheel.style.transform = `rotate(${P.angle}deg)`; stage.classList.add('spinning'); }, 60));
    boardTimers.push(setTimeout(() => { stage.classList.remove('spinning'); stage.classList.add('done'); }, PATRON_SPIN_MS - 300));
    return;
  }
  patchPatron();
  const slot = $app.querySelector('[data-pay]');
  if (!slot) return;
  const role = P.role, badge = role === 'champion' ? 'diamond' : 'crown';
  import('./pay.js').then(({ mountPay }) => mountPay(slot, {
    amount: P.amount, lang,
    labels: { card: T('payCard'), cardPay: T('payCardGo', (P.amount / 100).toLocaleString(lang)), close: T('later') },
    on: {
      start() { ui.patron.pay = 'paying'; $app.querySelector('[data-pay-error]')?.setAttribute('hidden', ''); },
      success() {
        saveBadge(badge);
        send({ t: 'paid', badge });
        Object.assign(ui.patron, { pay: 'thanks', badge });
        render();
      },
      cancel() { ui.patron.pay = 'idle'; if (view.phase !== 'patron') render(); },
      error() {
        ui.patron.pay = 'idle';
        if (view.phase !== 'patron') return render();
        $app.querySelector('[data-pay-error]')?.removeAttribute('hidden');
      },
      unavailable() { slot.hidden = true; },
    },
  })).then(off => { if (slot.isConnected) unmountPay = off; else off?.(); }).catch(() => { slot.hidden = true; });
}

// Mises à jour sans redessiner : bandeaux des paiements, encouragements, petit mot au champion.
function patchPatron() {
  const P = ui.patron.view;
  const box = $app.querySelector('[data-banners]');
  if (box) {
    const others = P.paid.filter(x => x.name !== myName() || ui.patron.pay !== 'thanks');
    box.innerHTML = others.map(x => `<div class="paid-banner ${x.badge}">${T(x.badge === 'diamond' ? 'paidDiamond' : 'paidCrown', esc(x.name))}</div>`).join('');
  }
  const nudge = $app.querySelector('[data-nudge]');
  if (nudge && P.role === 'champion' && P.patron && P.paid.some(x => x.role === 'patron')) {
    nudge.textContent = T('champNudge', P.patron);
    nudge.hidden = false;
  }
  if (P.cheer && P.cheer.seq > ui.patron.cheerSeen) {
    ui.patron.cheerSeen = P.cheer.seq;
    const toast = $app.querySelector('[data-cheered]');
    if (toast) {
      toast.textContent = T('cheered', P.cheer.from);
      toast.hidden = false;
      toast.classList.remove('show'); void toast.offsetWidth; toast.classList.add('show');
      setTimeout(() => { toast.hidden = true; }, 3000);
    }
    navigator.vibrate?.(200);
  }
}

function rainBills() {
  const box = $app.querySelector('[data-rain]');
  if (!box || reducedMotion()) return;
  for (let i = 0; i < 14; i++) {
    const b = document.createElement('i');
    b.textContent = '💸';
    b.style.cssText = `left:${5 + Math.random() * 90}%;animation-delay:${Math.round(Math.random() * 900)}ms;--r:${Math.round(Math.random() * 60 - 30)}deg`;
    box.append(b);
  }
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
    if (!ready.length) { box.innerHTML = `<p class="wait">${T('loadingPhotos')}</p>`; return; }
    const s = ready[slideIndex++ % ready.length];
    box.innerHTML = `<figure class="slide">
      <img src="${mediaCache.get(s.id)}" alt="">
      <figcaption>${T('photoBy', esc(s.author))}</figcaption>
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

document.addEventListener('click', unlockAudio, true);

$app.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const { act } = el.dataset;
  if (act === 'privacy') { setUi({ screen: 'privacy' }); scrollTo(0, 0); }
  else if (act === 'privacy-close') { setUi({ screen: 'home' }); scrollTo(0, 0); }
  else if (act === 'howto') { setUi({ screen: 'howto', howto: el.dataset.os }); scrollTo(0, 0); }
  else if (act === 'howto-close') { setUi({ screen: 'home' }); scrollTo(0, 0); }
  else if (act === 'cancel-join') { forgetCode(); setUi({ screen: 'home', error: '', notice: '' }); }
  else if (act === 'home') {
    if (!game && !client && ui.screen !== 'game') return setUi({ screen: 'home', error: '', notice: '' });
    if (ui.screen === 'game' && view?.phase !== 'end' && !confirm(game ? T('quitHost') : T('quitGuest'))) return;
    leaveGame();
  }
  else if (act === 'lang') {
    if (el.dataset.lang === lang) return;
    setLang(el.dataset.lang);
    saveLang(lang);
    if (params.has('lang')) { params.delete('lang'); history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : '')); }
    render();
  }
  else if (act === 'admit') send({ t: 'admit', id: el.dataset.id, ok: el.dataset.ok === '1' });
  else if (act === 'claim') { ui.pickName = false; ui.memberQuery = ''; ui.outsideForm = false; send({ t: 'claim', author: el.dataset.author }); }
  else if (act === 'outside') { setUi({ outsideForm: true }); $app.querySelector('[data-form=outside] input')?.focus(); }
  else if (act === 'change-name') setUi({ pickName: true });
  else if (act === 'more-members') { ui.allMembers = !ui.allMembers; filterMembers(); }
  else if (act === 'vote') send({ t: 'vote', n: view.round.n, author: el.dataset.author });
  else if (act === 'set') send({ t: 'settings', settings: { [el.dataset.key]: Number(el.dataset.value) } });
  else if (act === 'start' || act === 'next' || act === 'replay' || act === 'skip') {
    send({ t: act });
    if (act === 'start' && game?.phase === 'question') countGame();
  }
  else if (act === 'enable-sound') {
    unlockAudio();
    // Le contexte audio démarre de façon asynchrone : on rejoint la musique en cours dès qu'il tourne.
    setTimeout(() => { $app.dataset.key = ''; render(); }, 150);
  }
  else if (act === 'patron-later' || act === 'patron-continue') {
    ui.patron.dismissed = true;
    if (ui.patron.pay !== 'thanks') ui.patron.pay = 'idle';
    send({ t: 'patron-done' });
    render();
    scrollTo(0, 0);
  }
  else if (act === 'cheer') {
    send({ t: 'cheer' });
    el.disabled = true;                 // un encouragement toutes les 5 secondes
    setTimeout(() => { el.disabled = false; }, 5000);
  }
  else if (act === 'pay-anyway') setUi({ patron: { ...ui.patron, showPay: true } });
  else if (act === 'share-game') {
    // Message neutre : ni prénom ni score, seulement le lien du jeu.
    const text = T('shareGameText'), url = T('shareGameUrl');
    try {
      if (navigator.share) await navigator.share({ title: 'Who is bro ?', text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); el.textContent = T('linkCopied'); }
    } catch { /* partage annulé */ }
  }

});

$app.addEventListener('change', e => {
  const input = e.target.dataset.input;
  if (input === 'file' && e.target.files[0]) { const file = e.target.files[0]; host(async () => file); }
  if (input === 'absent') send({ t: 'settings', settings: { absent: e.target.checked } });
});

$app.addEventListener('input', e => {
  if (e.target.dataset.input === 'member-search') { ui.memberQuery = e.target.value; filterMembers(); }
  if (e.target.dataset.input === 'outside-name') ui.outsideName = e.target.value;
});

$app.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.dataset.form === 'join') join(joinCode(), new FormData(e.target).get('name') || '');
  if (e.target.dataset.form === 'outside') {
    const name = String(new FormData(e.target).get('name') || '').trim();
    if (!name) return;
    store.set('ctt-name', name);
    ui.pickName = false; ui.outsideForm = false; ui.memberQuery = ''; ui.outsideName = undefined;
    send({ t: 'outside', name });
  }
});


// Lien d'invitation : on rejoint tout de suite si on connaît déjà le prénom, sinon on le demande.
pruneSaves(myId, 5 * 60 * 1000);   // parties abandonnées (onglet fermé depuis plus de 5 minutes)
if (store.get('ctt-hosting')) resumeHost();
else {
  if (params.get('p') && store.get('ctt-name')) join(params.get('p'));
  else render();
}
