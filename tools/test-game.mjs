// Simule une partie complète côté hôte (sans réseau) et vérifie les règles.
//   node tools/test-game.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseChat } from '../js/whatsapp.js';
import { analyze } from '../js/tics.js';
import { Game } from '../js/game.js';

const name = 'Discussion WhatsApp avec Les Potes.txt';
const analysis = analyze(parseChat(readFileSync(new URL('../samples/' + name, import.meta.url), 'utf8'), name));
const game = new Game(analysis, 'TEST', 'h', () => {});
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
  assert.equal(game.view('c').round.votes.h, answer, 'les votes des autres se voient en direct');
  game.handle('b', { t: 'vote', n, author: 'Inès' });       // change d'avis : c'est le dernier vote qui compte
  game.handle('c', { t: 'vote', n: n + 1, author: answer }); // mauvaise manche : ignoré
  game.reveal();
  const r = game.view('c').round;
  assert.equal(r.answer, answer);
  assert.equal(r.votes.b, 'Inès');
  assert.equal(r.votes.c, undefined);
  game.handle('h', { t: 'next' });
}
assert.equal(game.phase, 'end');
for (let i = 1; i < owners.length; i++) assert.notEqual(owners[i], owners[i - 1], 'jamais deux fois de suite le même');
assert.deepEqual([...new Set(owners)].sort(), ['Inès', 'Julie Moreau', 'Karim B']);
assert.equal(game.players.get('h').score, 6);
assert.equal(game.players.get('b').score, owners.filter(o => o === 'Inès').length);
assert.equal(game.players.get('c').score, 0);

const played = new Set(game.used);
game.handle('h', { t: 'replay' });
game.handle('h', { t: 'start' });
assert.ok(game.deck.every(c => !played.has(c.owner + '|' + c.tic.text)), 'on rejoue avec d\'autres tics');
assert.equal(game.players.get('h').score, 0, 'scores remis à zéro');

// Tout le monde a voté : il ne reste que 5 secondes, pendant lesquelles on peut encore changer d'avis.
game.handle('h', { t: 'vote', n: 1, author: 'Inès' });
game.handle('b', { t: 'vote', n: 1, author: 'Inès' });
game.leave('c');
const v = game.view('h').round;
assert.ok(v.allVoted && v.remaining <= 5000, 'temps raccourci quand tous les joueurs présents ont voté');
game.handle('b', { t: 'vote', n: 1, author: 'Karim B' });
await new Promise(r => setTimeout(r, 5500));
assert.equal(game.phase, 'reveal');
assert.equal(game.round.votes.b, 'Karim B', 'le changement de dernière seconde est pris en compte');
clearTimeout(game.timer);
console.log('OK —', owners.join(' › '));
