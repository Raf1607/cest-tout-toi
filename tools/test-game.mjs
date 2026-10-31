// Simule une partie complète côté hôte (sans réseau) et vérifie les règles.
//   node tools/test-game.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseChat } from '../js/whatsapp.js';
import { analyze } from '../js/tics.js';
import { Game, WHEEL } from '../js/game.js';
import { readZipExport } from './zip-export.mjs';

const name = 'Discussion WhatsApp avec Les Potes.txt';
const analysis = analyze(parseChat(readFileSync(new URL('../samples/' + name, import.meta.url), 'utf8'), name));
const game = new Game(analysis, 'TEST', 'h', () => {});
game.wheelChance = 0;
game.join('b');
game.join('c');

assert.equal(game.canStart().ok, false, 'personne n\'a choisi son nom');
game.handle('h', { t: 'claim', author: 'Julie Moreau' });
game.handle('b', { t: 'claim', author: 'Julie Moreau' });
assert.equal(game.players.get('b').author, null, 'un nom déjà pris par un joueur connecté reste à lui');
game.handle('b', { t: 'claim', author: 'Karim B' });
game.handle('c', { t: 'claim', author: 'Inès' });
game.handle('b', { t: 'start' });
assert.equal(game.phase, 'lobby', 'seul l\'hôte lance la partie');
game.handle('h', { t: 'settings', settings: { rounds: 6, seconds: 15 } });
game.handle('h', { t: 'start' });
assert.equal(game.phase, 'question');
assert.deepEqual(game.options, ['Inès', 'Julie Moreau', 'Karim B']);

const owners = [];
for (let n = 1; n <= 6; n++) {
  const v = game.view('b');
  assert.equal(v.round.answer, undefined, 'la réponse ne fuit pas pendant la question');
  const answer = game.round.card.owner;
  owners.push(answer);
  game.handle('h', { t: 'vote', n, author: answer });
  game.handle('b', { t: 'vote', n, author: answer });
  const seen = game.view('c');
  assert.equal(seen.round.votes, undefined, 'les votes des autres restent secrets pendant la manche');
  assert.ok(seen.players.find(p => p.id === 'h').voted, 'on voit qui a voté');
  assert.ok(seen.round.remaining <= 7000, 'dès le premier vote, il reste 7 secondes');
  game.handle('b', { t: 'vote', n, author: 'Inès' });       // change d'avis : c'est le dernier vote qui compte
  game.handle('c', { t: 'vote', n: n + 1, author: answer }); // mauvaise manche : ignoré
  game.reveal();
  const r = game.view('c').round;
  assert.equal(r.answer, answer);
  assert.equal(r.votes.b, 'Inès');
  assert.equal(r.votes.c, undefined);
  game.handle('h', { t: 'next' });
  game.advance();
}
assert.equal(game.phase, 'end');
for (let i = 1; i < owners.length; i++) assert.notEqual(owners[i], owners[i - 1], 'jamais deux fois de suite le même');
assert.deepEqual([...new Set(owners)].sort(), ['Inès', 'Julie Moreau', 'Karim B']);
assert.equal(game.players.get('h').score, 12, '2 points par bonne réponse');
let expected = 0;
for (const o of owners) expected = o === 'Inès' ? expected + 2 : Math.max(0, expected - 1);
assert.equal(game.players.get('b').score, expected, '1 point en moins par mauvaise réponse, jamais sous zéro');
assert.equal(game.players.get('c').score, 0);

const played = new Set(game.used);
game.handle('h', { t: 'replay' });
game.handle('h', { t: 'start' });
assert.ok(game.deck.filter(c => !c.tic.id).every(c => !played.has(c.owner + '|' + (c.tic.file || c.tic.text))), 'on rejoue avec d\'autres tics');
assert.equal(game.players.get('h').score, 0, 'scores remis à zéro');

// On peut changer d'avis, et la manche se termine dès que tous les joueurs présents ont voté.
game.handle('h', { t: 'vote', n: 1, author: 'Inès' });
game.handle('b', { t: 'vote', n: 1, author: 'Inès' });
game.handle('b', { t: 'vote', n: 1, author: 'Karim B' });
assert.equal(game.phase, 'question', 'on attend encore le troisième joueur');
game.leave('c');
await new Promise(r => setTimeout(r, 800));
assert.equal(game.phase, 'reveal', 'fin automatique quand tout le monde a voté');
assert.equal(game.round.votes.b, 'Karim B', 'le changement d\'avis est pris en compte');
clearTimeout(game.timer);

// Après chaque réponse, le classement : anciennes places, nouvelles places, points gagnés ou perdus.
const r1 = new Game(analysis, 'RANK', 'h', () => {});
r1.wheelChance = 0;
r1.join('b');
r1.handle('h', { t: 'claim', author: 'Julie Moreau' });
r1.handle('b', { t: 'claim', author: 'Karim B' });
r1.handle('h', { t: 'start' });
const roundOf = async (right, wrong) => {
  const answer = r1.round.card.owner, bad = r1.options.find(o => o !== answer);
  r1.handle(right, { t: 'vote', n: r1.round.n, author: answer });
  r1.handle(wrong, { t: 'vote', n: r1.round.n, author: bad });
  r1.reveal();
  r1.handle('h', { t: 'next' });
  assert.equal(r1.phase, 'ranking', 'le classement s\'affiche entre les manches');
  const rows = r1.view('h').ranking.rows;
  r1.advance();
  return rows;
};
await roundOf('h', 'b');
await roundOf('h', 'b');
await roundOf('b', 'h');
let rows = await roundOf('b', 'h');
assert.deepEqual(rows.map(p => [p.id, p.score, p.delta]), [['b', 4, 2], ['h', 2, -1]], 'b dépasse h');
assert.deepEqual(rows.map(p => p.was), [1, 0], 'chacun part de son ancienne place');
clearTimeout(r1.timer);

// Export avec médias : stickers, GIF, habitudes et (en option) photos dans les manches.
const zipName = 'WhatsApp Chat - Les Potes (avec médias).zip';
const exp = readZipExport(fileURLToPath(new URL('../samples/' + zipName, import.meta.url)));
const media = new Game(analyze(parseChat(exp.text, zipName), exp.files), 'MEDI', 'h', () => {});
media.wheelChance = 0;
['h', 'b', 'c', 'd'].forEach(id => media.join(id));
['Julie Moreau', 'Karim B', 'Inès', 'Thomas Lefèvre'].forEach((name, i) => media.handle('hbcd'[i], { t: 'claim', author: name }));
media.handle('h', { t: 'settings', settings: { rounds: 20, photos: true } });
media.handle('h', { t: 'start' });
const kinds = new Set(media.deck.map(c => c.tic.kind));
for (const k of ['photo', 'record']) assert.ok(kinds.has(k), `une manche de type ${k}`);
assert.ok(kinds.has('sticker') || kinds.has('gif') || media.deck.length < 20, 'une manche sticker ou GIF');
assert.ok(media.deck.every((c, i) => !i || c.owner !== media.deck[i - 1].owner), 'jamais deux fois de suite le même, records compris');
for (let i = 0; i < media.deck.length; i++) {
  const q = media.view('b').round;
  assert.equal(q.answer, undefined);
  if (['sticker', 'gif', 'photo'].includes(q.kind)) assert.ok(q.media?.id && exp.files.has(q.media.id), 'le média de la manche existe dans l\'export');
  media.reveal();
  media.next();
  media.advance();
}
assert.equal(media.phase, 'end');
// Roue de la fortune : hasard, bonus pour le premier votant, malus pour le premier du classement.
{
  const w = new Game(analysis, 'ROUE', 'h', () => {});
  w.wheelChance = 1;
  w.join('b');
  w.handle('h', { t: 'claim', author: 'Julie Moreau' });
  w.handle('b', { t: 'claim', author: 'Karim B' });
  w.handle('h', { t: 'settings', settings: { rounds: 20 } });
  w.handle('h', { t: 'start' });
  const seen = new Set();
  for (let i = 0; i < 12 && w.phase === 'question'; i++) {
    const answer = w.round.card.owner, bad = w.options.find(o => o !== answer);
    w.handle('b', { t: 'vote', n: w.round.n, author: bad });     // b vote en premier, et se trompe
    w.handle('h', { t: 'vote', n: w.round.n, author: answer });  // h prend la tête
    w.reveal();
    w.next();
    w.advance();
    assert.equal(w.phase, 'wheel');
    const seg = WHEEL[w.wheel.index];
    seen.add(seg.id);
    if (!w.wheel.shielded) assert.equal(w.wheel.target, seg.kind === 'bonus' ? 'b' : w.order[0], `cible de ${seg.id}`);
    const fx = { ...w.pending };
    w.advance();
    if (w.phase !== 'question') break;
    const hv = w.view('h').round, bv = w.view('b').round;
    if (fx.flou === 'h') assert.ok(hv.blurred && !bv.blurred, 'seul le visé a la question floue');
    if (fx.flou) { w.handle('b', { t: 'vote', n: w.round.n, author: answer }); assert.ok(!w.view('h').round.blurred, 'net dès le premier vote'); w.round.votes = {}; w.round.first = undefined; }
    if (fx.melange === 'h') { assert.ok(hv.labels && !bv.labels); for (const n of w.options) assert.equal([...hv.labels[n].toLowerCase()].sort().join(''), [...n.toLowerCase()].sort().join(''), 'mêmes lettres'); }
    if (fx.lettre === 'b') assert.ok(w.round.card.owner.split(' ')[0].toUpperCase().includes(bv.hint) && !hv.hint, 'lettre du prénom à trouver');
    if (fx.double === 'b') assert.ok(bv.double && !hv.double);
  }
  clearTimeout(w.timer);
  assert.ok(seen.size >= 2, 'la roue varie');
  // Roue désactivée par l'hôte : elle ne sort jamais.
  const off = new Game(analysis, 'OFF', 'h', () => {});
  off.wheelChance = 1;
  off.join('b');
  off.handle('h', { t: 'claim', author: 'Julie Moreau' });
  off.handle('b', { t: 'claim', author: 'Karim B' });
  off.handle('h', { t: 'settings', settings: { wheel: false } });
  off.handle('h', { t: 'start' });
  off.handle('b', { t: 'vote', n: 1, author: 'Karim B' });
  off.reveal(); off.next(); off.advance();
  assert.equal(off.phase, 'question', 'pas de roue quand elle est désactivée');
  clearTimeout(off.timer);
  // Bouclier : il bloque un malus, une seule fois.
  const s = new Game(analysis, 'BOUC', 'h', () => {});
  s.wheelChance = 0;
  s.join('b');
  s.handle('h', { t: 'claim', author: 'Julie Moreau' });
  s.handle('b', { t: 'claim', author: 'Karim B' });
  s.handle('h', { t: 'start' });
  s.reveal(); s.order = ['h', 'b']; s.players.get('h').score = 5; s.shields.add('h'); s.round.first = 'b';
  const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  const force = id => { const i = WHEEL.findIndex(x => x.id === id); globalThis.crypto.getRandomValues = a => { a[0] = i; return a; }; };
  force('moins2'); s.spin();
  assert.ok(s.wheel.shielded && s.players.get('h').score === 5 && !s.shields.has('h'), 'le bouclier absorbe le malus');
  s.spin();
  assert.equal(s.players.get('h').score, 3, 'sans bouclier, -2 points');
  globalThis.crypto.getRandomValues = real;
  clearTimeout(s.timer);
}

console.log('OK —', owners.join(' › '), '· médias :', [...kinds].join(', '));
