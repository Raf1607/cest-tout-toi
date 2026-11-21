// Simule une partie complète côté hôte (sans réseau) et vérifie les règles.
//   node tools/test-game.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseChat } from '../js/whatsapp.js';
import { analyze } from '../js/tics.js';
import { Game, WHEEL, MAX_CHOICES, categoryOf } from '../js/game.js';
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
assert.deepEqual(game.settings, { rounds: 10, seconds: 25, absent: true, photos: true, slideshow: true, wheel: true }, 'toutes les options cochées par défaut');
game.handle('h', { t: 'settings', settings: { rounds: 10, seconds: 15, absent: false } });
game.handle('h', { t: 'start' });
assert.equal(game.phase, 'question');
assert.deepEqual(game.options, ['Inès', 'Julie Moreau', 'Karim B']);

const owners = [];
for (let n = 1; n <= 10; n++) {
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
assert.equal(game.players.get('h').score, 20, '2 points par bonne réponse');
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
assert.equal(media.phase, 'montage', 'le montage précède le classement final');
const mv = media.view('b').montage;
assert.ok(mv.items.length >= 15, 'au moins 15 médias dans le montage');
assert.ok(mv.items.every(m => exp.files.has(m.id)));
assert.equal(new Set(mv.items.map(m => m.id)).size, mv.items.length, 'pas de doublon');
media.handle('b', { t: 'skip' });
assert.equal(media.phase, 'montage', 'seul l\'hôte peut passer le montage');
media.handle('h', { t: 'skip' });
assert.equal(media.phase, 'end');
// Roue de la fortune : huit cases, une chance sur trois après chaque manche.
{
  const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  // Force la case tirée (et, pour les tirages de joueurs, le même indice modulo la liste).
  const force = (g, id) => {
    const cases = WHEEL.map((_, i) => i).filter(i => WHEEL[i].id !== 'extra' || g.spare);
    const k = cases.indexOf(WHEEL.findIndex(x => x.id === id));
    globalThis.crypto.getRandomValues = a => { a[0] = k; return a; };
  };
  const unforce = () => { globalThis.crypto.getRandomValues = real; };
  const setup = rounds => {
    const g = new Game(analysis, 'ROUE', 'h', () => {});
    g.wheelChance = 0;
    g.join('b');
    g.handle('h', { t: 'claim', author: 'Julie Moreau' });
    g.handle('b', { t: 'claim', author: 'Karim B' });
    g.handle('h', { t: 'settings', settings: { rounds } });
    g.handle('h', { t: 'start' });
    return g;
  };
  // Manche jouée : h trouve, b se trompe (h en tête, b dernier), puis la roue sur la case voulue.
  const playThenSpin = (g, id) => {
    const answer = g.round.card.owner, bad = g.round.options.find(o => o !== answer);
    g.handle('b', { t: 'vote', n: g.round.n, author: bad });
    g.handle('h', { t: 'vote', n: g.round.n, author: answer });
    g.reveal(); g.next();
    force(g, id); g.spin(); unforce();
    assert.equal(g.phase, 'wheel');
    assert.equal(WHEEL[g.wheel.index].id, id);
  };
  const nextRound = g => { g.advance(); assert.equal(g.phase, 'question'); return g.round.card.owner; };

  assert.equal(WHEEL.length, 8, 'huit cases');
  // Coup de pouce : le dernier marque double.
  let g = setup(10);
  playThenSpin(g, 'pouce');
  assert.equal(g.wheel.target, 'b', 'coup de pouce pour le dernier');
  let answer = nextRound(g);
  assert.equal(g.view('b').round.boost, 'pouce'); assert.equal(g.view('h').round.boost, undefined);
  let before = g.players.get('b').score;
  g.handle('b', { t: 'vote', n: g.round.n, author: answer }); g.reveal();
  assert.equal(g.players.get('b').score - before, 4, '+4 avec le coup de pouce');
  clearTimeout(g.timer);

  // Manche double : +4 et −2 pour tout le monde.
  g = setup(10);
  playThenSpin(g, 'manche');
  answer = nextRound(g);
  assert.ok(g.view('h').round.all && g.view('b').round.all);
  g.players.get('b').score = 5;
  const hb = g.players.get('h').score;
  g.handle('h', { t: 'vote', n: g.round.n, author: answer });
  g.handle('b', { t: 'vote', n: g.round.n, author: g.round.options.find(o => o !== answer) });
  g.reveal();
  assert.equal(g.players.get('h').score - hb, 4, '+4 en manche double');
  assert.equal(g.players.get('b').score, 3, '−2 en manche double');
  clearTimeout(g.timer);

  // Course au ×2 : le premier à trouver (heure de son dernier vote) marque double.
  g = setup(10);
  playThenSpin(g, 'course');
  answer = nextRound(g);
  assert.ok(g.view('h').round.course && g.view('b').round.course);
  const bad = g.round.options.find(o => o !== answer);
  g.handle('h', { t: 'vote', n: g.round.n, author: bad });         // h vote en premier, mais faux
  g.handle('b', { t: 'vote', n: g.round.n, author: answer });
  g.round.at.b -= 50;
  g.handle('h', { t: 'vote', n: g.round.n, author: answer });      // h change d'avis : il arrive après b
  const [h0, b0] = [g.players.get('h').score, g.players.get('b').score];
  g.reveal();
  assert.equal(g.round.racer, 'b', 'le premier qui trouve gagne la course');
  assert.equal(g.players.get('b').score - b0, 4); assert.equal(g.players.get('h').score - h0, 2);
  assert.equal(g.view('h').round.racer, 'b');
  clearTimeout(g.timer);
  g = setup(10);
  playThenSpin(g, 'course');
  answer = nextRound(g);
  g.handle('h', { t: 'vote', n: g.round.n, author: g.round.options.find(o => o !== answer) });
  g.reveal();
  assert.equal(g.view('h').round.racer, '', 'personne n\'a trouvé : le ×2 est perdu');
  clearTimeout(g.timer);

  // Roulette : un joueur au hasard marque double ; la liste des prénoms défile.
  g = setup(10);
  playThenSpin(g, 'roulette');
  assert.ok(['h', 'b'].includes(g.wheel.target) && g.view('h').wheel.names.length === 2);
  const lucky = g.wheel.target;
  nextRound(g);
  assert.equal(g.view(lucky).round.boost, 'roulette');
  clearTimeout(g.timer);

  // Question floue : pour le premier, jusqu'au premier vote.
  g = setup(10);
  playThenSpin(g, 'flou');
  assert.equal(g.wheel.target, 'h');
  answer = nextRound(g);
  assert.ok(g.view('h').round.blurred && g.view('h').round.flou && !g.view('b').round.blurred, 'seul le premier a la question floue');
  g.handle('b', { t: 'vote', n: g.round.n, author: answer });
  assert.ok(!g.view('h').round.blurred, 'nette dès le premier vote');
  clearTimeout(g.timer);

  // Question bonus : une manche de plus, une seule fois par partie.
  g = setup(10);
  assert.equal(g.deck.length, 10); assert.ok(g.spare, 'une carte en réserve');
  playThenSpin(g, 'extra');
  assert.equal(g.deck.length, 11); assert.equal(g.spare, null);
  assert.ok(!WHEEL.map((_, i) => i).filter(i => WHEEL[i].id !== 'extra' || g.spare).some(i => WHEEL[i].id === 'extra'), 'plus de question bonus sur la roue');
  g.index = 9; g.advance();
  assert.equal(g.view('h').round.bonus, true); assert.equal(g.view('h').round.total, 11);
  clearTimeout(g.timer);

  // −2 au premier, et bouclier : il bloque un malus jusqu'au tour de roue suivant.
  g = setup(10);
  playThenSpin(g, 'moins2');
  assert.equal(g.wheel.target, 'h');
  assert.equal(g.players.get('h').score, 0, '−2 immédiat, jamais sous zéro');
  g.players.get('h').score = 5; g.shields.add('h');
  force(g, 'moins2'); g.spin(); unforce();
  assert.ok(g.wheel.shielded && g.players.get('h').score === 5, 'le bouclier bloque le malus');
  force(g, 'moins2'); g.spin(); unforce();
  assert.equal(g.players.get('h').score, 3, 'bouclier utilisé : −2');
  g.shields.add('b');
  force(g, 'pouce'); g.spin(); unforce();
  assert.ok(!g.shields.has('b'), 'le bouclier disparaît au tour de roue suivant');
  force(g, 'bouclier'); g.spin(); unforce();
  assert.equal(g.shields.size, 1, 'bouclier pour un joueur au hasard');
  g.next();
  assert.ok(g.view('h').ranking.rows.some(r => r.shield), 'le bouclier se voit au classement');
  clearTimeout(g.timer);

  // Chance d'un tour de roue, et roue désactivée par l'hôte.
  g = setup(10); g.wheelChance = 1;
  g.reveal(); g.next(); g.advance();
  assert.equal(g.phase, 'wheel', 'la roue tourne même si personne n\'a voté');
  clearTimeout(g.timer);
  const off = new Game(analysis, 'OFF', 'h', () => {});
  off.wheelChance = 1;
  off.handle('h', { t: 'claim', author: 'Julie Moreau' });
  off.handle('h', { t: 'settings', settings: { wheel: false, absent: true } });
  off.handle('h', { t: 'start' });
  off.reveal(); off.next(); off.advance();
  assert.equal(off.phase, 'question', 'pas de roue quand elle est désactivée');
  clearTimeout(off.timer);
  const last = setup(10); last.wheelChance = 1;
  last.index = 9; last.ask(); last.reveal(); last.next(); last.advance();
  assert.notEqual(last.phase, 'wheel', 'jamais de roue après la dernière manche');
  clearTimeout(last.timer);
}

// Verrouillage : un nouveau téléphone attend l'accord de l'hôte, ne reçoit rien avant, et
// plus personne de nouveau n'entre une fois la partie lancée.
{
  const turned = [];
  const g = new Game(analysis, 'LOCK', 'h', () => {});
  g.onAdmit = (id, why) => turned.push([id, why]);
  assert.equal(g.request('x', 'Intrus'), 'wait');
  assert.ok(!g.players.has('x'), 'pas joueur tant que l\'hôte n\'a pas accepté');
  g.handle('x', { t: 'claim', author: 'Karim B' });
  assert.ok(![...g.players.values()].some(p => p.author === 'Karim B'), 'un téléphone en attente ne peut rien faire');
  assert.deepEqual(g.view('h').waiting, [{ id: 'x', name: 'Intrus' }], 'l\'hôte voit la demande');
  g.handle('b', { t: 'admit', id: 'x', ok: true });
  assert.ok(!g.players.has('x'), 'seul l\'hôte peut accepter');
  g.handle('h', { t: 'admit', id: 'x', ok: false });
  assert.deepEqual(turned, [['x', 'refused']]);
  assert.equal(g.request('x', 'Intrus'), 'refused', 'un refus est définitif');
  assert.equal(g.request('b', 'Karim'), 'wait');
  g.handle('h', { t: 'admit', id: 'b', ok: true });
  assert.ok(g.players.has('b'));
  g.handle('h', { t: 'claim', author: 'Julie Moreau' });
  g.handle('b', { t: 'claim', author: 'Karim B' });
  assert.equal(g.request('y', 'Retard'), 'wait');
  g.handle('h', { t: 'start' });
  assert.deepEqual(turned.at(-1), ['y', 'closed'], 'les demandes en attente sont refusées au lancement');
  assert.equal(g.request('z', 'Inconnu'), 'closed', 'partie fermée une fois lancée');
  g.leave('b');
  assert.equal(g.request('b', 'Karim'), 'ok', 'un joueur accepté revient sans redemander');
  clearTimeout(g.timer);
}

// Partie en anglais : export américain (AM/PM, « image omitted »), textes générés en anglais.
{
  const enName = 'WhatsApp Chat - The Crew (with media).zip';
  const enExp = readZipExport(fileURLToPath(new URL('../samples/' + enName, import.meta.url)));
  const chat = parseChat(enExp.text, enName);
  assert.equal(chat.title, 'The Crew');
  assert.ok(chat.medias.some(m => m.kind === 'sticker') && chat.messages.length > 1500, 'export anglais lu');
  const en = new Game(analyze(chat, enExp.files, 'en'), 'ENGL', 'h', () => {});
  en.wheelChance = 0;
  ['h', 'b', 'c'].forEach(id => en.join(id));
  assert.equal(en.view('h').canStart.reason, 'needClaim', 'raison sous forme de code, traduite par l\'écran');
  ['Emma Walsh', 'Jay P', 'Priya'].forEach((name, i) => en.handle('hbc'[i], { t: 'claim', author: name }));
  en.handle('h', { t: 'settings', settings: { rounds: 20 } });
  en.handle('h', { t: 'start' });
  assert.equal(en.view('b').lang, 'en', 'les invités reçoivent la langue de la partie');
  const texts = en.deck.map(c => `${c.tic.text} ${c.tic.detail || ''}`).join(' ');
  assert.ok(!/[àéèç]|qui |fois|messages, contre|Typique/.test(texts), 'aucun texte français dans une partie anglaise');
  assert.ok(en.deck.some(c => c.tic.kind === 'record' && /^[a-z]/.test(c.tic.text)), 'records en anglais');
  assert.ok(en.analysis.authors.find(a => a.name === 'Jay P').tics.some(t => t.text === 'hold on'), '« hold on » est une expression');
  clearTimeout(en.timer);
}

// Rechargement de la page de l'hôte : la partie reprend telle quelle (structured clone, comme IndexedDB).
{
  const a = new Game(analysis, 'RELO', 'h', () => {});
  a.wheelChance = 0;
  a.join('b');
  a.handle('h', { t: 'claim', author: 'Julie Moreau' });
  a.handle('b', { t: 'claim', author: 'Karim B' });
  a.handle('h', { t: 'settings', settings: { absent: false } });
  a.handle('h', { t: 'start' });
  const answer = a.round.card.owner;
  a.handle('b', { t: 'vote', n: 1, author: answer });
  a.reveal(); a.next(); a.advance();
  a.handle('h', { t: 'vote', n: 2, author: a.round.card.owner });
  const snap = structuredClone(a.snapshot());
  clearTimeout(a.timer);
  const r = Game.restore(structuredClone(analysis), snap);
  assert.equal(r.code, 'RELO');
  assert.equal(r.phase, 'question');
  assert.equal(r.round.n, 2, 'même manche');
  assert.equal(r.round.votes.h, a.round.votes.h, 'les votes sont gardés');
  assert.equal(r.players.get('b').score, a.players.get('b').score, 'les scores sont gardés');
  assert.ok(!r.players.get('b').connected && r.players.get('h').connected, 'les invités doivent revenir');
  assert.ok(r.round.endsAt - Date.now() >= 14000, 'le temps de revenir avant la fin de la manche');
  assert.equal(r.request('b', 'Karim'), 'ok', 'un invité déjà accepté revient directement');
  assert.equal(r.request('z', 'Inconnu'), 'closed', 'toujours fermée aux nouveaux');
  assert.equal(r.view('b').round.n, 2);
  clearTimeout(r.timer);
}

// Grand groupe : 6 réponses au plus, la bonne et les joueurs présents toujours dedans,
// jamais un membre trop peu actif comme leurre.
{
  const big = new Game(structuredClone(analysis), 'GROS', 'h', () => {});
  const base = big.analysis.authors.length;
  for (let i = 0; i < 30; i++) big.analysis.authors.push({ name: `Membre ${i}`, messages: i < 2 ? 3 : 400, tics: [], photos: [], stats: {} });
  big.join('b');
  big.handle('h', { t: 'claim', author: 'Julie Moreau' });
  big.handle('b', { t: 'claim', author: 'Membre 0' });
  big.options = big.analysis.authors.map(a => a.name);
  assert.ok(big.options.length > base + 20);
  for (let k = 0; k < 200; k++) {
    const owner = big.options[k % big.options.length];
    const choices = big.choicesFor(owner);
    assert.equal(choices.length, MAX_CHOICES, 'six réponses');
    assert.equal(new Set(choices).size, MAX_CHOICES, 'pas de doublon');
    assert.ok(choices.includes(owner), 'la bonne réponse est proposée');
    assert.ok(choices.includes('Julie Moreau') && choices.includes('Membre 0'), 'les joueurs présents sont proposés');
    if (owner !== 'Membre 1') assert.ok(!choices.includes('Membre 1'), 'un membre trop peu actif ne sert pas de leurre');
  }
}

// Joueurs hors discussion : ils votent et marquent des points, mais ne sont jamais une réponse.
// Si personne (ou presque) n'est dans la discussion, les membres absents sont toujours de la partie.
{
  const out = new Game(analysis, 'HORS', 'h', () => {});
  out.wheelChance = 0;
  assert.equal(out.request('x', 'Zoé'), 'wait');
  out.admit('x', true);
  assert.equal(out.players.get('x').name, 'Zoé', 'le prénom tapé pour entrer est gardé');
  out.handle('h', { t: 'settings', settings: { absent: false, rounds: 3 } });
  out.handle('h', { t: 'outside', name: '  ' });
  assert.equal(out.players.get('h').outside, false, 'il faut un prénom');
  out.handle('h', { t: 'outside', name: 'Léo' });
  out.handle('x', { t: 'outside', name: 'Zoé' });
  assert.equal(out.canStart().ok, true, 'deux invités hors discussion peuvent lancer');
  out.handle('h', { t: 'start' });
  assert.equal(out.phase, 'question');
  assert.ok(out.options.length >= 2 && !out.options.includes('Léo') && !out.options.includes('Zoé'), 'les invités ne sont jamais une réponse');
  const answer = out.round.card.owner;
  out.handle('h', { t: 'vote', n: 1, author: answer });
  out.handle('x', { t: 'vote', n: 1, author: out.round.options.find(o => o !== answer) });
  out.reveal();
  assert.equal(out.players.get('h').score, 2, 'un invité marque des points');
  out.handle('h', { t: 'next' });
  assert.deepEqual(out.view('h').ranking.rows.map(r => r.name).sort(), ['Léo', 'Zoé'], 'le classement affiche leurs prénoms');
  assert.ok(out.view('x').players.every(p => p.outside));
  clearTimeout(out.timer);

  // Un invité peut redevenir un membre, et inversement.
  const mix = new Game(analysis, 'MIX', 'h', () => {});
  mix.join('x');
  mix.handle('h', { t: 'claim', author: 'Inès' });
  mix.handle('x', { t: 'outside', name: 'Zoé' });
  mix.handle('h', { t: 'settings', settings: { absent: false } });
  assert.deepEqual(mix.candidates().sort(), mix.analysis.authors.filter(a => a.tics.length).map(a => a.name).sort(), 'un seul membre en jeu : les absents sont ajoutés');
  mix.handle('x', { t: 'claim', author: 'Karim B' });
  assert.equal(mix.players.get('x').outside, false);
  assert.deepEqual(mix.candidates(), ['Inès', 'Karim B'], 'deux membres en jeu, absents décochés : rien de plus');
}

// Composition de la partie : chaque joueur présent a sa question, la réserve n'est la seule question
// de personne, les photos sont les plus commentées, les titres et le culte sont bien joués.
{
  const shots = media.analysis.authors.flatMap(a => a.photos);
  const best = Math.max(...shots.map(p => p.score));
  assert.ok(best > 0 && media.analysis.authors.every(a => a.photos.every((p, i) => !i || a.photos[i - 1].score >= p.score)), 'photos triées par réactions');
  for (let g = 0; g < 60; g++) {
    const m = new Game(media.analysis, 'COMP', 'h', () => {});
    m.wheelChance = 0;
    ['h', 'b'].forEach(id => m.join(id));
    m.handle('h', { t: 'claim', author: 'Julie Moreau' });
    m.handle('b', { t: 'claim', author: 'Inès' });
    m.handle('h', { t: 'settings', settings: { rounds: 10, photos: true, absent: true } });
    m.handle('h', { t: 'start' });
    const played = m.deck.slice(0, 10);
    assert.equal(played.length, 10);
    for (const name of ['Julie Moreau', 'Inès']) assert.ok(played.some(c => c.owner === name), `${name} est la réponse d'au moins une manche`);
    assert.ok(played.some(c => c.tic.kind === 'culte') && played.some(c => c.tic.kind === 'record'), 'titres et culte joués');
    const by = cat => played.filter(c => categoryOf(c.tic.kind) === cat).length;
    assert.deepEqual([by('message'), by('titre'), by('photo'), by('tic')], [3, 2, 2, 3], 'répartition sur dix manches : 3 messages, 2 titres, 2 photos, 3 tics');
    assert.ok(!played.some(c => c.tic.kind === 'ponct'), 'jamais de ponctuation');
    assert.ok(played.filter(c => c.tic.kind === 'debut' || c.tic.kind === 'fin').length <= 1, 'un début ou une fin au plus');
    assert.ok(['Julie Moreau', 'Inès'].includes(played[0].owner), 'la première question porte sur un joueur');
    assert.ok(played.every((c, i) => !i || c.owner !== played[i - 1].owner), 'jamais deux fois de suite le même');
    assert.ok(m.deck.every((c, i, d) => !i || i < 10 || c.tic !== d[i - 1].tic), 'réserve distincte');
    clearTimeout(m.timer);
  }
}

console.log('OK —', owners.join(' › '), '· médias :', [...kinds].join(', '));
