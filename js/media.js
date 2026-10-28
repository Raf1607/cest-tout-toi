// Médias de l'export : lecture du zip sans le charger en entier (un export avec médias peut
// peser des centaines de Mo), préparation des images à montrer, et transport en morceaux
// (un message trop gros ne passe pas dans la connexion entre téléphones).
/* global zip */

const CHUNK = 16000;
const PHOTO_MAX = 900;   // côté le plus long d'une photo envoyée aux joueurs, en pixels
const MIME = { webp: 'image/webp', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4', mov: 'video/quicktime' };
const mimeOf = name => MIME[name.split('.').pop().toLowerCase()] || 'application/octet-stream';

// → { text, files: nom → { key, size } pour l'analyse, entries: nom → fichier du zip }.
// La clé (taille + CRC, lus dans le sommaire du zip) reconnaît un même sticker envoyé plusieurs fois.
export async function readExport(file) {
  const empty = { files: new Map(), entries: new Map() };
  if (!/\.zip$/i.test(file.name) && !/zip/.test(file.type)) return { text: await file.text(), ...empty };
  zip.configure({ useWebWorkers: false });
  const reader = new zip.ZipReader(new zip.BlobReader(file));
  const all = (await reader.getEntries()).filter(e => !e.directory && !/(^|\/)__MACOSX\//.test(e.filename));
  const chats = all.filter(e => /\.txt$/i.test(e.filename))
    .sort((a, b) => /_chat\.txt$/.test(b.filename) - /_chat\.txt$/.test(a.filename));
  if (!chats.length) throw new Error('Ce fichier zip ne contient pas de discussion (.txt).');
  const text = await chats[0].getData(new zip.TextWriter());
  const { files, entries } = empty;
  for (const e of all) {
    if (e === chats[0]) continue;
    const name = e.filename.split('/').pop();
    files.set(name, { key: `${e.uncompressedSize}:${e.signature}`, size: e.uncompressedSize });
    entries.set(name, e);
  }
  return { text, files, entries };
}

// Le fichier à montrer ; une photo est réduite pour partir vite vers les autres téléphones.
export async function mediaBlob(entry, name, isPhoto) {
  const blob = await entry.getData(new zip.BlobWriter(mimeOf(name)));
  if (!isPhoto) return blob;
  try {
    const img = await createImageBitmap(blob);
    const k = Math.min(1, PHOTO_MAX / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * k);
    canvas.height = Math.round(img.height * k);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise(resolve => canvas.toBlob(b => resolve(b || blob), 'image/jpeg', 0.8));
  } catch {
    return blob;   // format que le navigateur ne sait pas redimensionner : envoyé tel quel
  }
}

export async function toChunks(id, blob) {
  const data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  const n = Math.ceil(data.length / CHUNK);
  return Array.from({ length: n }, (_, i) => ({ t: 'media', id, i, n, d: data.slice(i * CHUNK, (i + 1) * CHUNK) }));
}

// Côté invité : rassemble les morceaux, puis onReady(id, url) quand le média est complet.
export class MediaInbox {
  constructor(onReady) { this.onReady = onReady; this.parts = new Map(); }

  add({ id, i, n, d }) {
    if (typeof id !== 'string' || !(n > 0) || !(i >= 0 && i < n)) return;
    if (!this.parts.has(id)) this.parts.set(id, { n, got: 0, list: new Array(n) });
    const p = this.parts.get(id);
    if (p.list[i] !== undefined) return;
    p.list[i] = d;
    if (++p.got < p.n) return;
    this.parts.delete(id);
    const data = p.list.join('');
    if (!/^data:(image|video)\//.test(data)) return;   // seulement des images et des vidéos
    fetch(data).then(r => r.blob()).then(b => this.onReady(id, URL.createObjectURL(b))).catch(() => {});
  }
}
