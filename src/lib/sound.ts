/**
 * Synthesized rather than sampled: no asset downloads, no licensing, and the
 * whole kit is a few hundred bytes. Audio is created lazily because browsers
 * block an AudioContext until the user has interacted with the page.
 */
let ctx: AudioContext | null = null;
let enabled = read();

function read(): boolean {
  try {
    return localStorage.getItem('vck:sound') !== 'off';
  } catch {
    return true;
  }
}

export function soundEnabled(): boolean {
  return enabled;
}

export function toggleSound(): boolean {
  enabled = !enabled;
  try {
    localStorage.setItem('vck:sound', enabled ? 'on' : 'off');
  } catch {
    /* preference just won't persist */
  }
  return enabled;
}

function tone(freq: number, ms: number, type: OscillatorType = 'sine', gain = 0.05) {
  if (!enabled) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(gain, ctx.currentTime);
    // Exponential ramp avoids the click a hard stop produces.
    amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
    osc.connect(amp).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  } catch {
    /* audio is a nicety; never let it break the game */
  }
}

export const sfx = {
  correct() {
    tone(660, 90, 'sine');
    setTimeout(() => tone(880, 140, 'sine'), 90);
  },
  someoneGuessed() {
    tone(520, 70, 'triangle', 0.035);
  },
  yourTurn() {
    tone(440, 110, 'sine');
    setTimeout(() => tone(587, 160, 'sine'), 110);
  },
  tick() {
    tone(300, 50, 'square', 0.025);
  },
  roundEnd() {
    tone(392, 120, 'sine');
    setTimeout(() => tone(294, 200, 'sine'), 120);
  },
  finish() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 180, 'sine'), i * 110));
  },
};
