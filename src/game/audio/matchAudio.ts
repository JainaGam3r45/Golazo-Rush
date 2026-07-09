import { DEFAULT_VOLUME, isSoundMuted } from '../../lib/storage/soundPreference';

let audioCtx: AudioContext | null = null;
let ambientNode: AudioBufferSourceNode | null = null;
let ambientFilter: BiquadFilterNode | null = null;
let ambientGain: GainNode | null = null;
let unlocked = false;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  return audioCtx;
}

function effectiveGain(base = DEFAULT_VOLUME): number {
  return isSoundMuted() ? 0 : base;
}

export function unlockMatchAudio(): void {
  const ctx = getContext();
  if (!ctx || unlocked) return;
  unlocked = true;
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }
  startAmbient();
}

export function stopMatchAudio(): void {
  if (ambientNode) {
    try {
      ambientNode.stop();
    } catch {
      // already stopped
    }
    ambientNode.disconnect();
    ambientNode = null;
  }
  if (ambientFilter) {
    ambientFilter.disconnect();
    ambientFilter = null;
  }
  if (ambientGain) {
    ambientGain.disconnect();
    ambientGain = null;
  }
}

export function disposeMatchAudio(): void {
  stopMatchAudio();
  if (audioCtx) {
    void audioCtx.close();
    audioCtx = null;
  }
  unlocked = false;
}

function createPinkNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return buffer;
}

function startAmbient(): void {
  const ctx = getContext();
  if (!ctx || ambientNode) return;

  const buffer = createPinkNoiseBuffer(ctx, 4);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  ambientFilter = ctx.createBiquadFilter();
  ambientFilter.type = 'lowpass';
  ambientFilter.frequency.value = 400;

  ambientGain = ctx.createGain();
  ambientGain.gain.value = effectiveGain(0.06);

  source.connect(ambientFilter);
  ambientFilter.connect(ambientGain);
  ambientGain.connect(ctx.destination);
  source.start();
  ambientNode = source;
}

export function refreshAmbientVolume(): void {
  if (ambientGain) {
    ambientGain.gain.value = effectiveGain(0.06);
  }
}

export function playKick(): void {
  const ctx = getContext();
  if (!ctx || !unlocked) return;

  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(effectiveGain(0.45), now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  gain.connect(ctx.destination);

  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 320;
  filter.Q.value = 0.8;

  source.connect(filter);
  filter.connect(gain);
  source.start(now);
  source.stop(now + 0.08);
}

export function playGoal(): void {
  const ctx = getContext();
  if (!ctx || !unlocked) return;

  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = effectiveGain(0.5);
  master.connect(ctx.destination);

  const tones = [523.25, 659.25, 783.99];
  for (let i = 0; i < tones.length; i++) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = tones[i];
    g.gain.setValueAtTime(0, now + i * 0.08);
    g.gain.linearRampToValueAtTime(0.35, now + i * 0.08 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.35);
    osc.connect(g);
    g.connect(master);
    osc.start(now + i * 0.08);
    osc.stop(now + i * 0.08 + 0.4);
  }

  const crowd = createPinkNoiseBuffer(ctx, 0.5);
  const crowdSource = ctx.createBufferSource();
  crowdSource.buffer = crowd;
  const crowdGain = ctx.createGain();
  crowdGain.gain.setValueAtTime(effectiveGain(0.2), now + 0.1);
  crowdGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
  const crowdFilter = ctx.createBiquadFilter();
  crowdFilter.type = 'lowpass';
  crowdFilter.frequency.value = 1200;
  crowdSource.connect(crowdFilter);
  crowdFilter.connect(crowdGain);
  crowdGain.connect(master);
  crowdSource.start(now + 0.1);
  crowdSource.stop(now + 0.65);
}

export function playWhistle(): void {
  const ctx = getContext();
  if (!ctx || !unlocked) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1800, now);
  osc.frequency.linearRampToValueAtTime(900, now + 0.25);
  gain.gain.setValueAtTime(effectiveGain(0.35), now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.3);
}

export function playPass(): void {
  const ctx = getContext();
  if (!ctx || !unlocked) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(420, now);
  osc.frequency.exponentialRampToValueAtTime(280, now + 0.1);
  gain.gain.setValueAtTime(effectiveGain(0.25), now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.12);
}

export function playLongKick(): void {
  const ctx = getContext();
  if (!ctx || !unlocked) return;

  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(effectiveGain(0.4), now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  gain.connect(ctx.destination);

  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.12), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 220;
  source.connect(filter);
  filter.connect(gain);
  source.start(now);
  source.stop(now + 0.15);
}

export function playTackle(): void {
  const ctx = getContext();
  if (!ctx || !unlocked) return;

  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(effectiveGain(0.35), now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  gain.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(90, now + 0.06);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.2, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  osc.connect(oscGain);
  oscGain.connect(gain);
  osc.start(now);
  osc.stop(now + 0.08);
}

export function playFoul(): void {
  playWhistle();
  const ctx = getContext();
  if (!ctx || !unlocked) return;

  const now = ctx.currentTime + 0.35;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1600, now);
  osc.frequency.linearRampToValueAtTime(800, now + 0.2);
  gain.gain.setValueAtTime(effectiveGain(0.3), now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.25);
}
