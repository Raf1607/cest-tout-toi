// Musique de fin de partie : afro house joyeuse, 124 BPM, en la majeur (A – F#m – D – E), un seul morceau
// continu de 10 mesures (≈ 20 s) ou 15 mesures (≈ 30 s) dont les 3 premières sont le « Sounds on ».
// Le morceau est découpé en 6 pistes ; chaque téléphone joue les siennes en avant et le reste très bas
// (fond de sécurité), le tout parti au même instant sur tous les téléphones (horloge commune, js/clock.js).
// Source : les pistes en fichiers quand elles seront livrées (FILES), sinon une synthèse dans le navigateur
// (reprise du prototype tools/music/afrohouse.html). Aucun fichier, aucun droit pour la synthèse.
// iOS n'autorise le son qu'après un toucher : unlockAudio() est appelé au premier geste de chaque joueur.

export const MUSIC_BPM = 124;
const STEP = 60 / MUSIC_BPM / 4, SWING = 0.12;
export const BAR = STEP * 16;                    // secondes (≈ 1,935)
export const BEAT = STEP * 4;
export const PREP_BARS = 3, SHORT_BARS = 10, LONG_BARS = 15, LONG_MIN_PHOTOS = 10;
export const TAIL = 1;                           // secondes de traîne après la dernière mesure
export const ARRANGEMENT = {
  short: ['prep0', 'prep1', 'prep2', 'drop', 'drop', 'drop', 'drop', 'drop', 'drop', 'outro'],
  long: ['prep0', 'prep1', 'prep2', 'groove', 'groove', 'groove', 'groove', 'build', 'drop', 'drop', 'drop', 'drop', 'drop', 'drop', 'outro'],
};
export const firstDrop = version => ARRANGEMENT[version].indexOf('drop');
export const STEMS = ['kick', 'bass', 'perc', 'chords', 'lead', 'fx'];
export const STEM_ICONS = { kick: '🥁', bass: '🎸', perc: '🪘', chords: '🎹', lead: '🎶', fx: '✨', all: '🎧' };
const BED = 0.126;                                // le reste du morceau, à −18 dB

// Pistes en fichiers (prod) : audio/fin/{short|long}-{piste}.m4a et -mix.m4a. Tant qu'elles ne sont pas
// livrées, on synthétise.
export const FILES = false;

let ctx = null;
export function audioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  // iPhone en mode silencieux : la musique doit sortir quand même.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* Safari ancien */ }
  ctx ||= new Ctx();
  return ctx;
}
export function unlockAudio() {
  const c = audioContext();
  if (c?.state === 'suspended') c.resume().catch(() => {});
}
export const audioRunning = () => ctx?.state === 'running';
export const outputLatency = () => (ctx ? ctx.outputLatency || ctx.baseLatency || 0 : 0);

// ——— Synthèse ———
const N = { A4: 440, B4: 493.88, Cs5: 554.37, D5: 587.33, E5: 659.25, Fs5: 739.99, Gs5: 830.61, A5: 880, B5: 987.77, Cs6: 1108.73 };
const CHORDS = [                                  // une mesure chacun : A maj7, F#m7, D maj7, E6
  { root: 55, notes: [220, 277.18, 329.63, 415.3] },
  { root: 46.25, notes: [185, 220, 277.18, 329.63] },
  { root: 73.42, notes: [146.83, 185, 220, 277.18] },
  { root: 41.2, notes: [164.81, 207.65, 246.94, 277.18] },
];
const LEAD = [
  { 0: N.A5, 2: N.E5, 4: N.A5, 7: N.B5, 10: N.Cs6, 12: N.B5, 14: N.A5 },
  { 0: N.Fs5, 2: N.Cs5, 4: N.Fs5, 7: N.A5, 10: N.B5, 12: N.A5, 14: N.Fs5 },
  { 0: N.Fs5, 2: N.D5, 4: N.Fs5, 7: N.A5, 10: N.B5, 12: N.A5, 15: N.Fs5 },
  { 0: N.E5, 3: N.Gs5, 6: N.B5, 10: N.Gs5, 12: N.B5, 13: N.Cs6, 14: N.B5 },
];
const LEAD_HI = LEAD.map(bar => {
  const out = { ...bar };
  for (const k of Object.keys(bar)) if (k % 4 === 0 && !out[+k + 1]) out[+k + 1] = bar[k];
  return out;
});
const BASS = { 2: 1, 3: 1, 6: 1, 7: 2, 10: 1, 11: 1.5, 14: 1, 15: 2 };
const CONGA_HI = [2, 5, 10, 13], CONGA_LO = [7, 15], CONGA_MID = [11];
const STABS = [3, 6, 11, 14];
const SECTIONS = {
  prep0: ['lead', 'shaker'], prep1: ['lead', 'shaker', 'conga', 'rim'], prep2: ['lead', 'shaker', 'conga', 'rim', 'hat', 'riser'],
  groove: ['kick', 'bass', 'lead', 'shaker', 'conga', 'rim', 'hat', 'clap'], build: ['lead', 'shaker', 'conga', 'roll', 'riser', 'bassHalf'],
  drop: ['kick', 'bass', 'lead', 'leadHi', 'shaker', 'conga', 'rim', 'hat', 'clap', 'stabs'], outro: ['outro'],
};

// Un moteur par lecture : c (contexte audio, éventuellement hors temps réel), out (nœud de sortie),
// skipBefore : rien n'est joué avant cet instant (rejoindre un morceau en cours).
function synth(c, skipBefore) {
  const noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  let duck = null, bassCut = 1500;
  const env = (g, t, peak, decay, attack = 0.002) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  const noise = (out, t, dur, type, freq, level, q = 1, freqEnd) => {
    if (t < skipBefore) return;
    const s = c.createBufferSource(); s.buffer = noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain(); env(g, t, level, dur);
    s.connect(f).connect(g).connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  };
  const osc = (out, t, type, f0, f1, glide, level, decay, attack) => {
    if (t < skipBefore) return;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
    const g = c.createGain(); env(g, t, level, decay, attack);
    o.connect(g).connect(out); o.start(t); o.stop(t + decay + 0.05);
  };
  const kick = (out, t, v = 1) => {
    osc(out, t, 'sine', 210, 43, 0.085, 1.0 * v, 0.55, 0.001);
    osc(out, t, 'triangle', 110, 40, 0.06, 0.45 * v, 0.28, 0.001);
    noise(out, t, 0.018, 'highpass', 2200, 0.55 * v);
    noise(out, t, 0.05, 'bandpass', 900, 0.25 * v, 1.5);
    if (duck && t >= skipBefore) { duck.gain.cancelScheduledValues(t); duck.gain.setValueAtTime(0.3, t); duck.gain.linearRampToValueAtTime(1, t + STEP * 2.2); }
  };
  const ride = (out, t) => noise(out, t, 0.28, 'highpass', 9000, 0.09);
  const tick16 = (out, t, v) => noise(out, t, 0.012, 'highpass', 10000, v);
  const clap = (out, t, v = 1) => { for (const dt of [0, 0.011, 0.023]) noise(out, t + dt, 0.018, 'bandpass', 1500, 0.45 * v, 1.2); noise(out, t + 0.03, 0.16, 'bandpass', 1400, 0.38 * v, 1); };
  const hat = (out, t, open) => noise(out, t, open ? 0.09 : 0.025, 'highpass', 8000, open ? 0.2 : 0.13);
  const shaker = (out, t, v) => noise(out, t, 0.04, 'bandpass', 6500, v, 1.5);
  const conga = (out, t, f0, f1, v = 0.45) => osc(out, t, 'sine', f0, f1, 0.07, v, 0.17);
  const rim = (out, t) => { osc(out, t, 'triangle', 1750, null, 0, 0.16, 0.035); noise(out, t, 0.008, 'highpass', 4000, 0.12); };
  const bass = (out, t, f, dur) => {
    if (t < skipBefore) return;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 11;
    lp.frequency.setValueAtTime(bassCut, t); lp.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = c.createGain(); env(g, t, 0.3, dur, 0.004);
    o.connect(lp).connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
    osc(out, t, 'square', f * 2, null, 0, 0.05, dur * 0.8, 0.004);   // octave au-dessus : audible sur un téléphone
  };
  const stab = (out, t, notes, dur = 0.26, v = 1) => {
    if (t < skipBefore) return;
    for (const n of notes) for (const det of [-7, 7]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = n; o.detune.value = det;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
      lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(700, t + dur);
      const g = c.createGain(); env(g, t, 0.045 * v, dur, 0.005);
      o.connect(lp).connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
    }
  };
  const kalimba = (out, t, f, v = 1) => {
    osc(out, t, 'sine', f, null, 0, 0.3 * v, 0.55);
    osc(out, t, 'triangle', f, null, 0, 0.08 * v, 0.22);
    osc(out, t, 'sine', f * 5.4, null, 0, 0.05 * v, 0.06);
  };
  const riser = (out, t, dur) => { noise(out, t, dur, 'bandpass', 400, 0.3, 2, 7000); osc(out, t, 'sine', 220, 1400, dur, 0.04, dur, dur * 0.8); };
  const crash = (out, t) => noise(out, t, 1.8, 'highpass', 4500, 0.32);
  const downlifter = (out, t) => noise(out, t, 1.5, 'bandpass', 5000, 0.22, 1.5, 300);

  function bar(S, sec, i, t0, drop, isFirstDrop) {
    const chord = CHORDS[i % 4];
    bassCut = sec === 'drop' ? 1600 + drop * 450 : sec === 'groove' ? 1100 : 1400;
    const at = s => t0 + s * STEP + (s % 2 ? SWING * STEP : 0);
    const has = SECTIONS[sec], on = k => has.includes(k);
    for (let s = 0; s < 16; s++) {
      const t = at(s);
      if (on('kick') && s % 4 === 0) kick(S.kick, t);
      if ((on('bass') || (on('bassHalf') && s < 8)) && BASS[s]) bass(S.bass, t, chord.root * BASS[s], STEP * 1.6);
      if (on('clap') && (s === 4 || s === 12)) clap(S.perc, t);
      if (on('hat') && s % 4 === 2) hat(S.perc, t, true);
      if (on('hat') && on('kick') && s % 2 === 1) hat(S.perc, t, false);
      if (on('shaker')) shaker(S.perc, t, s % 4 === 2 ? 0.16 : 0.08);
      if (on('stabs') && s % 4 === 2) ride(S.perc, t);
      if (on('kick')) tick16(S.perc, t, s % 4 === 0 ? 0.03 : s % 2 ? 0.05 : 0.08);
      if (on('conga')) {
        if (CONGA_HI.includes(s)) conga(S.perc, t, 420, 330);
        if (CONGA_MID.includes(s)) conga(S.perc, t, 300, 240);
        if (CONGA_LO.includes(s)) conga(S.perc, t, 210, 160, 0.5);
      }
      if (on('rim') && (s === 3 || s === 9 || s === 14)) rim(S.perc, t);
      if (on('roll') && [0, 4, 8, 10, 12, 13, 14, 15].includes(s)) clap(S.perc, t, 0.4 + s / 25);
      if (on('stabs') && STABS.includes(s)) stab(S.chords, t, chord.notes);
      const lead = on('leadHi') && i % 8 >= 4 ? LEAD_HI[i % 4] : LEAD[i % 4];
      if (on('lead') && lead[s]) kalimba(S.lead, t, lead[s], sec.startsWith('prep') ? 0.8 : 1);
    }
    if (on('riser')) riser(S.fx, t0, BAR);
    if (isFirstDrop) { crash(S.fx, t0); kick(S.fx, t0, 0.6); }
    if (sec === 'outro') {
      kick(S.kick, t0); stab(S.chords, t0, chord.notes, 1.4, 1.3); kalimba(S.lead, t0, N.A5); kalimba(S.lead, t0 + STEP * 3, N.E5, 0.7);
      kalimba(S.lead, t0 + STEP * 6, N.A4, 0.6); crash(S.fx, t0); downlifter(S.fx, t0 + STEP * 2);
    }
  }

  // Tout le morceau, à partir de t0 (temps du contexte). Renvoie les gains par piste et le bus de sortie.
  return function play(version, t0, destination) {
    const bars = ARRANGEMENT[version];
    const bus = c.createGain(); bus.gain.value = 0.55;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
    lp.connect(comp).connect(bus).connect(destination);
    const delay = c.createDelay(1); delay.delayTime.value = STEP * 3;      // écho sur la kalimba
    const fb = c.createGain(); fb.gain.value = 0.32;
    const wet = c.createGain(); wet.gain.value = 0.28;
    duck = c.createGain(); duck.connect(lp);
    const gains = {};
    for (const k of STEMS) { const g = c.createGain(); g.connect(['bass', 'chords', 'lead'].includes(k) ? duck : lp); gains[k] = g; }
    gains.lead.connect(delay); delay.connect(fb).connect(delay); delay.connect(wet).connect(lp);
    const t = i => t0 + i * BAR, drop = firstDrop(version), end = t(bars.length);
    // Filtre général : « Sounds on » étouffé qui s'ouvre, puis grand ouvert au lancement du montage.
    lp.frequency.setValueAtTime(700, t0);
    lp.frequency.exponentialRampToValueAtTime(1600, t(2));
    lp.frequency.exponentialRampToValueAtTime(5000, t(3) - 0.02);
    lp.frequency.setValueAtTime(version === 'long' ? 9000 : 20000, t(3));
    if (version === 'long') { lp.frequency.setValueAtTime(9000, t(drop - 1)); lp.frequency.exponentialRampToValueAtTime(18000, t(drop) - 0.02); lp.frequency.setValueAtTime(20000, t(drop)); }
    lp.frequency.setValueAtTime(20000, end - BAR); lp.frequency.exponentialRampToValueAtTime(900, end + 0.6);
    bus.gain.setValueAtTime(0.55, end); bus.gain.linearRampToValueAtTime(0.0001, end + 1.2);
    bars.forEach((sec, i) => bar(gains, sec, i, t(i), Math.max(0, i - drop), i === drop));
    return { gains, bus };
  };
}

// Gains des pistes : les siennes devant, le reste en fond. solo : tout le morceau (téléphone seul).
const levels = (mine, solo) => Object.fromEntries(STEMS.map(k => [k, solo || mine.includes(k) ? 1 : BED]));

// Lance le morceau. at : instant du début de la mesure 1, en temps du contexte audio (peut être passé :
// on rejoint alors le morceau en cours). Renvoie { stop(fondu), setMine(pistes, instant) }.
export function startMusic({ version, at, mine = [], solo = false }) {
  const c = audioContext();
  if (!c) return null;
  const now = c.currentTime;
  const play = synth(c, now + 0.02);
  const { gains, bus } = play(version, at, c.destination);
  const lv = levels(mine, solo);
  for (const k of STEMS) gains[k].gain.setValueAtTime(lv[k], now);
  return {
    stop(fade = 0.3) {
      const t = c.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(0.0001, t + fade);
      setTimeout(() => { try { bus.disconnect(); } catch { /* déjà parti */ } }, (fade + 0.1) * 1000);
    },
    // Une piste reprise d'un téléphone parti, à partir d'une mesure : bascule de gain en 20 ms.
    setMine(stems, when) {
      const next = levels(stems, solo);
      const t = Math.max(when, c.currentTime);
      for (const k of STEMS) { gains[k].gain.setValueAtTime(gains[k].gain.value, t); gains[k].gain.linearRampToValueAtTime(next[k], t + 0.02); }
    },
  };
}

// Le morceau entier, rendu hors temps réel (vidéo de présentation).
export async function renderMusic(version = 'long', rate = 48000) {
  const seconds = ARRANGEMENT[version].length * BAR + TAIL + 0.3;
  const c = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
  synth(c, -1)(version, 0.05, c.destination);
  return c.startRendering();
}
