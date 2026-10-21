/**
 * Synthesized rather than sampled: no asset downloads, no licensing, and the
 * whole kit is a few hundred bytes. Audio is created lazily because browsers
 * block an AudioContext until the user has interacted with the page.
 */
let ctx: AudioContext | null = null;
/** Something has played inside a tap, which older iOS needs before any sound. */
let primed = false;
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
  // Turning sound on is a tap: the moment iOS lets audio start.
  if (enabled) unlock();
  return enabled;
}

/** The one context, woken if the browser paused it (or a phone call did). */
function audio(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state !== 'running') void ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq: number, ms: number, type: OscillatorType = 'sine', gain = 0.05) {
  if (!enabled) return;
  try {
    const ac = audio();
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(gain, ac.currentTime);
    // Exponential ramp avoids the click a hard stop produces.
    amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + ms / 1000);
    osc.connect(amp).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + ms / 1000);
  } catch {
    /* audio is a nicety; never let it break the game */
  }
}

/**
 * iOS only lets audio start inside a tap, so a context first created by a
 * timer (a countdown running out) stays silent. Called from a tap, this
 * creates or wakes the context and plays one silent sample, which is what
 * older iOS versions wait for.
 */
function unlock() {
  if (!enabled) return;
  try {
    const ac = audio();
    if (primed) return;
    const src = ac.createBufferSource();
    src.buffer = ac.createBuffer(1, 1, 22050);
    src.connect(ac.destination);
    src.start(0);
    primed = true;
  } catch {
    /* audio is a nicety */
  }
}

/**
 * A short buzz on phones that support it (Android; iOS Safari ignores it).
 * Follows the sound toggle: "quiet" means quiet.
 */
function buzz(pattern: number | number[]) {
  if (!enabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* a nicety, like the sounds */
  }
}

export const sfx = {
  correct() {
    buzz([30, 50, 70]);
    tone(660, 90, 'sine');
    setTimeout(() => tone(880, 140, 'sine'), 90);
  },
  someoneGuessed() {
    tone(520, 70, 'triangle', 0.035);
  },
  yourTurn() {
    buzz([60, 80, 60]);
    tone(440, 110, 'sine');
    setTimeout(() => tone(587, 160, 'sine'), 110);
  },
  tick() {
    buzz(15);
    tone(300, 50, 'square', 0.025);
  },
  roundEnd() {
    tone(392, 120, 'sine');
    setTimeout(() => tone(294, 200, 'sine'), 120);
  },
  finish() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 180, 'sine'), i * 110));
  },
  /** An award lands: a short, bright two-note ding. */
  award() {
    tone(1175, 80, 'triangle', 0.04);
    setTimeout(() => tone(1760, 220, 'sine', 0.04), 70);
  },
  /** A new personal best: a quick run up into a held major chord. */
  fanfare() {
    [392, 523, 659].forEach((f, i) => setTimeout(() => tone(f, 120, 'triangle', 0.04), i * 85));
    setTimeout(() => {
      tone(784, 460, 'triangle', 0.035);
      tone(1047, 460, 'sine', 0.03);
      tone(1319, 460, 'sine', 0.025);
    }, 255);
  },
  /** The clock ran out: a low buzzer, and a buzz for a phone with its sound turned down. */
  timeUp() {
    buzz([200, 100, 200]);
    tone(330, 180, 'square', 0.03);
    setTimeout(() => tone(247, 420, 'square', 0.03), 200);
  },
  /** Call from a tap before a sound that a timer will play later (see unlock). */
  unlock,
};
