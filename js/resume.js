// Partie en cours gardée sur le téléphone de l'hôte (IndexedDB), pour qu'un rechargement de la page
// par erreur n'arrête pas tout. Rien ne quitte le téléphone. Chaque onglet d'hôte a ses propres
// entrées (« id:session », « id:state ») ; l'onglet en partie les met à jour au moins chaque minute.
// Au chargement du site, on efface celles qu'aucun onglet n'a touchées depuis quelques minutes
// (onglet fermé), et dans tous les cas celles qui ont plus de 3 heures.

const DB = 'whoisbro', STORE = 'partie';
const MAX_AGE = 3 * 60 * 60 * 1000;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let out;
      fn(tx.objectStore(STORE), v => { out = v; });
      tx.oncomplete = () => resolve(out);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const saveSave = (key, value) => run('readwrite', s => s.put({ at: Date.now(), value }, key));

export const loadSave = key => run('readonly', (s, done) => {
  const req = s.get(key);
  req.onsuccess = () => done(req.result && Date.now() - req.result.at < MAX_AGE ? req.result.value : null);
});

// Efface les parties abandonnées (sauf celle de l'onglet `keep`) : dernière mise à jour il y a plus de maxIdle.
export const pruneSaves = (keep, maxIdle) => run('readwrite', s => {
  const latest = new Map(), keys = [];
  const req = s.openCursor();
  req.onsuccess = () => {
    const c = req.result;
    if (c) {
      const owner = String(c.key).split(':')[0];
      keys.push([c.key, owner, c.value.at]);
      latest.set(owner, Math.max(latest.get(owner) || 0, c.value.at));
      return c.continue();
    }
    const now = Date.now();
    for (const [key, owner, at] of keys) {
      if (now - at > MAX_AGE || (owner !== keep && now - latest.get(owner) > maxIdle)) s.delete(key);
    }
  };
}).catch(() => { /* stockage indisponible */ });

export const clearSaves = owner => run('readwrite', s => {
  for (const k of ['session', 'state']) s.delete(`${owner}:${k}`);
}).catch(() => { /* rien à effacer */ });
