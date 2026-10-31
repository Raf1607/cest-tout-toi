// Musique du montage de fin : une boucle phonk originale, entièrement synthétisée dans le navigateur
// (cloche type 808, basse saturée, grosse caisse, clap, charleston). Aucun fichier audio, aucun droit.
// iOS n'autorise le son qu'après un toucher : unlockAudio() est appelé au premier geste de chaque joueur.

export const BPM = 140;
let ctx = null;

export function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  ctx ||= new Ctx();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function saturation(amount) {
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 511.5) - 1;
    curve[i] = Math.tanh(amount * x);
  }
  shaper.curve = curve;
  return shaper;
}

function cowbell(out, t, freq, level) {
  const gain = ctx.createGain();
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq * 1.3;
  band.Q.value = 1.2;
  for (const f of [freq, freq * 1.48]) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = f;
    osc.connect(band);
    osc.start(t);
    osc.stop(t + 0.32);
  }
  band.connect(gain).connect(out);
  gain.gain.setValueAtTime(level, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
}

function bass(out, t, freq, length) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq * 2.2, t);
  osc.frequency.exponentialRampToValueAtTime(freq, t + 0.06);
  gain.gain.setValueAtTime(0.95, t);
  gain.gain.exponentialRampToValueAtTime(0.01, t + length);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

function noise(out, t, length, type, cutoff, level) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  src.buffer = buffer;
  filter.type = type;
  filter.frequency.value = cutoff;
  gain.gain.setValueAtTime(level, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + length);
  src.connect(filter).connect(gain).connect(out);
  src.start(t);
}

// Motif sur 2 mesures de 16 doubles-croches : hauteurs de cloche (0 = silence), en fa mineur.
const F = 698.46, Ab = 830.61, C = 1046.5, Db = 1108.73, E = 1318.51;
const BELL = [F, 0, 0, F, 0, 0, Ab, 0, F, 0, 0, F, 0, C, 0, Db,
  F, 0, 0, F, 0, 0, Ab, 0, C, 0, Db, 0, C, 0, E, 0];
const KICK = new Set([0, 6, 10, 16, 22, 26, 29]);
const CLAP = new Set([4, 12, 20, 28]);
const BASS = { 0: 43.65, 6: 43.65, 10: 51.91, 16: 43.65, 22: 43.65, 26: 36.71, 29: 41.2 };

// Lance la musique pour `seconds` secondes ; renvoie une fonction qui l'arrête.
export function playPhonk(seconds) {
  if (!ctx) return () => {};
  ctx.resume?.();
  const master = ctx.createGain();
  master.gain.value = 0.75;
  const drive = saturation(3.2);
  drive.connect(master).connect(ctx.destination);
  const start = ctx.currentTime + 0.05;
  const step = 60 / BPM / 4;
  const total = Math.floor(seconds / step);
  for (let i = 0; i < total; i++) {
    const t = start + i * step, s = i % 32;
    if (i < 16) {                               // intro : la cloche seule, puis tout entre
      if (BELL[s]) cowbell(drive, t, BELL[s], 0.5);
      continue;
    }
    if (BELL[s]) cowbell(drive, t, BELL[s], 0.5);
    if (KICK.has(s)) noise(drive, t, 0.03, 'highpass', 2500, 0.5);
    if (BASS[s]) bass(drive, t, BASS[s], step * 5);
    if (CLAP.has(s)) noise(drive, t, 0.16, 'bandpass', 1800, 0.8);
    noise(drive, t, s % 4 === 2 ? 0.09 : 0.03, 'highpass', 8000, s % 2 ? 0.14 : 0.22);
  }
  master.gain.setValueAtTime(0.75, start + seconds - 0.9);
  master.gain.linearRampToValueAtTime(0.0001, start + seconds);
  return () => {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    setTimeout(() => master.disconnect(), 400);
  };
}
