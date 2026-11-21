// Score commun de toutes les questions, entre 0 et 1 : vaut-elle la peine d'être posée ?
//   score = fun × netteté^a × intensité^b × fiabilité^c        (exposants : TUNING.scoreExp)
// fun       : à quel point ce genre de question fait rire la table (grille à la main, TUNING.fun)
// netteté   : la réponse est-elle juste et devinable ? (l'écart avec le deuxième)
// intensité : à quel point la personne sort du lot (face au membre typique, la médiane des autres)
// fiabilité : combien d'occurrences derrière (3 : peu sûr, 20 : solide)
// Chaque type de question remplit ces trois notes à sa façon (voir les fonctions ci-dessous).
import { TUNING as T } from './tuning.js';

const clamp = x => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 1));
// Rapport → note : ×1 donne 0, ×2^sat donne 1 (échelle logarithmique).
export const sharp = ratio => clamp(Math.log2(Math.max(ratio, 1)) / T.sharpSat);
export const strong = ratio => clamp(Math.log2(Math.max(ratio, 1)) / T.intensitySat);
export const reliable = n => clamp(1 - Math.exp(-n / T.reliableN));

export function score(fun, netteté, intensité, fiabilité) {
  const [a, b, c] = T.scoreExp;
  return clamp(fun) * clamp(netteté) ** a * clamp(intensité) ** b * clamp(fiabilité) ** c;
}

export const median = list => {
  if (!list.length) return 0;
  const s = list.slice().sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Superlatif (titre, habitude) : v1 le gagnant, v2 le deuxième, med la médiane des autres, n ses occurrences.
// type : 'count' (un nombre : lissé de +1), 'share' (une part : lissée de +1 point), 'low' (le plus petit gagne).
export function superlative(fun, type, v1, v2, med, n) {
  const s = type === 'share' ? 0.01 : type === 'count' ? 1 : 0;
  const lead = type === 'low' ? v2 / v1 : (v1 + s) / (v2 + s);
  const above = type === 'low' ? med / v1 : (v1 + s) / (med + s);
  return { score: score(fun, sharp(lead), strong(above), n == null ? 1 : reliable(n)), lead, above };
}
