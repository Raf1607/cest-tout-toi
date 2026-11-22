// Horloge commune entre l'hôte et un invité, pour que la musique et le montage de fin partent au même
// instant sur tous les téléphones. Le temps de référence est performance.now() de l'hôte.
// L'invité envoie { t:'ping', a } ; l'hôte répond { t:'pong', a, h } (h : son heure à lui) ; à réception,
//   rtt = maintenant − a,  écart = h + rtt/2 − maintenant.
// On garde les 30 derniers échantillons ; l'écart retenu est la médiane des 8 au trajet le plus court
// (ceux que le réseau a le moins retardés), corrigé d'une dérive lente (les quartz ne battent pas tout à
// fait au même rythme). Pas de micro, pas d'écran : tout se fait pendant la partie, en tâche de fond.
const WINDOW = 30, BEST = 8;

const median = list => {
  const s = list.slice().sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export class Clock {
  constructor() { this.samples = []; }

  reset() { this.samples = []; }

  // Un aller-retour mesuré. a : l'heure locale d'envoi ; h : l'heure de l'hôte ; now : l'heure locale de réception.
  add(a, h, now) {
    const rtt = now - a;
    if (!(rtt >= 0) || rtt > 5000) return;
    this.samples.push({ t: now - rtt / 2, offset: h + rtt / 2 - now, rtt });
    if (this.samples.length > WINDOW) this.samples.shift();
  }

  get ready() { return this.samples.length >= 3; }

  // Qualité du calage : le trajet le plus court et l'écart-type des écarts retenus (ms).
  quality() {
    if (!this.samples.length) return { rtt: Infinity, jitter: Infinity };
    const best = this.best();
    const mean = best.reduce((s, x) => s + x.offset, 0) / best.length;
    const jitter = Math.sqrt(best.reduce((s, x) => s + (x.offset - mean) ** 2, 0) / best.length);
    return { rtt: Math.min(...this.samples.map(s => s.rtt)), jitter };
  }

  best() { return this.samples.slice().sort((x, y) => x.rtt - y.rtt).slice(0, BEST); }

  // Écart (heure de l'hôte − heure locale) à l'instant local `at`.
  offset(at) {
    if (!this.samples.length) return 0;
    const best = this.best();
    const base = median(best.map(s => s.offset));
    const t0 = median(best.map(s => s.t));
    return base + this.drift() * (at - t0);
  }

  // Dérive (ms d'écart par ms écoulée) : pente de l'écart dans le temps, sur toute la fenêtre. Ignorée tant
  // qu'on n'a pas au moins 10 s d'échantillons, et bornée (un quartz ne dérive pas de plus de 0,1 %).
  drift() {
    const s = this.samples;
    if (s.length < 6 || s[s.length - 1].t - s[0].t < 10000) return 0;
    const mt = s.reduce((x, y) => x + y.t, 0) / s.length, mo = s.reduce((x, y) => x + y.offset, 0) / s.length;
    let num = 0, den = 0;
    for (const x of s) { num += (x.t - mt) * (x.offset - mo); den += (x.t - mt) ** 2; }
    return den ? Math.max(-0.001, Math.min(0.001, num / den)) : 0;
  }

  toHost(local) { return local + this.offset(local); }
  toLocal(host) { return host - this.offset(host - this.offset(host)); }
}
