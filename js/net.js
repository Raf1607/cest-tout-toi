// Connexions entre téléphones, en pair-à-pair (WebRTC via la bibliothèque PeerJS et son
// serveur public de mise en relation) : l'hôte ouvre une salle nommée d'après le code de la
// partie, les invités s'y connectent. Les échanges de jeu ne passent par aucun serveur.
/* global Peer */

const PREFIX = 'cest-tout-toi-v1-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const OPTIONS = { reliable: true, serialization: 'json' };

const newCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');

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
export async function openRoom(onConnection) {
  for (let attempt = 0; ; attempt++) {
    const code = newCode();
    let peer;
    try {
      peer = await openPeer(PREFIX + code);
    } catch (err) {
      if (err.type === 'unavailable-id' && attempt < 5) continue;   // code déjà pris par une autre partie
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
  constructor(code, id, { onMessage, onStatus }) {
    Object.assign(this, { code, id, onMessage, onStatus, conn: null, joined: false, failures: 0, timer: null });
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
      conn.send({ t: 'hello', id: this.id });
    });
    conn.on('data', msg => this.onMessage(msg));
    conn.on('close', () => { if (this.conn === conn) this.retry(); });
    conn.on('error', () => { if (this.conn === conn) this.retry(); });
  }

  retry() {
    if (this.timer || this.peer.destroyed) return;
    this.conn = null;
    if (++this.failures > 15) { this.close(); this.onStatus('gone'); return; }
    this.onStatus('lost');
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.peer.open) this.connect(); else this.retry();
    }, 2000);
  }

  send(msg) { if (this.conn?.open) this.conn.send(msg); }

  close() {
    clearTimeout(this.timer);
    this.timer = null;
    this.peer.destroy();
  }
}
