// Connexions entre téléphones, en pair-à-pair (WebRTC via la bibliothèque PeerJS et son
// serveur public de mise en relation) : l'hôte ouvre une salle nommée d'après le code de la
// partie, les invités s'y connectent. Les échanges de jeu ne passent par aucun serveur.
/* global Peer */
import { Clock } from './clock.js';

const PREFIX = 'cest-tout-toi-v1-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const OPTIONS = { reliable: true, serialization: 'json' };

// 6 lettres parmi 24 : 191 millions de codes, impossible de tomber sur une partie au hasard.
export const CODE_LENGTH = 6;
const newCode = () => Array.from(crypto.getRandomValues(new Uint32Array(CODE_LENGTH)), n => LETTERS[n % LETTERS.length]).join('');

function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id) : new Peer();
    const fail = err => { peer.destroy(); reject(err); };
    peer.once('open', () => { peer.off('error', fail); resolve(peer); });
    peer.once('error', fail);
  });
}

// Après une coupure du serveur de mise en relation, on se réenregistre (les connexions
// déjà établies entre téléphones, elles, continuent de fonctionner).
function keepRegistered(peer) {
  peer.on('disconnected', () => setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 2000));
}

const OFFLINE = 'Impossible de joindre le serveur de mise en relation. Vérifie la connexion internet.';

// Hôte : ouvre la salle, appelle onConnection(conn) pour chaque téléphone qui s'y connecte.
// wanted : le code d'une partie à reprendre après un rechargement de la page. Le serveur de mise en
// relation peut le croire encore pris quelques secondes (l'ancienne page vient de se fermer) : on insiste.
export async function openRoom(onConnection, wanted = null) {
  for (let attempt = 0; ; attempt++) {
    const code = wanted || newCode();
    let peer;
    try {
      peer = await openPeer(PREFIX + code);
    } catch (err) {
      if (err.type === 'unavailable-id' && wanted && attempt < 15) { await new Promise(r => setTimeout(r, 2000)); continue; }
      if (err.type === 'unavailable-id' && !wanted && attempt < 5) continue;   // code déjà pris par une autre partie
      throw new Error(OFFLINE);
    }
    keepRegistered(peer);
    peer.on('error', err => console.warn('PeerJS', err.type, err.message));
    peer.on('connection', conn => onConnection(conn));
    return { peer, code };
  }
}

// Invité : se connecte à la salle et s'y reconnecte tout seul après une coupure.
// onStatus reçoit 'ok', 'lost' (reconnexion en cours), 'notfound' ou 'gone'.
export class Client {
  constructor(code, id, name, { onMessage, onStatus }) {
    Object.assign(this, { code, id, name, onMessage, onStatus, conn: null, joined: false, failures: 0, timer: null });
    // Horloge commune avec l'hôte (musique de fin synchronisée) : une rafale de 8 mesures à la connexion,
    // puis une toutes les 2 secondes pendant toute la partie ; on recommence au retour de veille.
    this.clock = new Clock();
    this.pinger = setInterval(() => this.ping(), 2000);
    this.onVisible = () => { if (document.visibilityState === 'visible') this.burst(); };
    document.addEventListener('visibilitychange', this.onVisible);
    this.peer = new Peer();
    keepRegistered(this.peer);
    this.peer.on('open', () => { if (!this.conn) this.connect(); });
    this.peer.on('error', err => {
      if (err.type === 'peer-unavailable' && !this.joined) { this.close(); onStatus('notfound'); }
      else if (!this.joined && (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error')) {
        this.close(); onStatus('offline');
      } else if (!this.conn?.open) this.retry();
      // Sinon, c'est le serveur de mise en relation qui a décroché (téléphone en veille, réseau
      // instable) : la connexion avec l'hôte, elle, tient toujours, on la garde.
    });
  }

  connect() {
    clearTimeout(this.timer);
    this.timer = null;
    const conn = this.peer.connect(PREFIX + this.code, OPTIONS);
    this.conn = conn;
    conn.on('open', () => {
      this.joined = true;
      this.failures = 0;
      this.onStatus('ok');
      conn.send({ t: 'hello', id: this.id, name: this.name });
      this.burst();
    });
    conn.on('data', msg => {
      if (msg?.t === 'pong') { if (typeof msg.a === 'number' && typeof msg.h === 'number') this.clock.add(msg.a, msg.h, performance.now()); return; }
      this.onMessage(msg);
    });
    conn.on('close', () => { if (this.conn === conn) this.retry(); });
    conn.on('error', () => { if (this.conn === conn) this.retry(); });
  }

  retry() {
    if (this.timer || this.peer.destroyed) return;
    this.conn = null;
    if (++this.failures > 40) { this.close(); this.onStatus('gone'); return; }   // ~80 s : le temps que l'hôte recharge sa page
    this.onStatus('lost');
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.peer.open) this.connect(); else this.retry();
    }, 2000);
  }

  send(msg) { try { if (this.conn?.open) this.conn.send(msg); } catch { this.retry(); } }

  ping() { this.send({ t: 'ping', a: performance.now() }); }

  // Rafale de 8 mesures espacées de 150 ms, après une connexion ou un retour de veille.
  burst() {
    this.clock.reset();
    for (let i = 0; i < 8; i++) setTimeout(() => this.ping(), i * 150);
  }

  // Heure de l'hôte, vue d'ici.
  hostNow() { return this.clock.toHost(performance.now()); }

  close() {
    clearTimeout(this.timer);
    this.timer = null;
    clearInterval(this.pinger);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.peer.destroy();
  }
}
