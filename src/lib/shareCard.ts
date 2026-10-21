import type { BestDrawing, GameSummary, SummaryPlayer } from '../generated/contract';
import { AVATARS, BACKDROPS, avatarSlot } from '../components/Avatar';
import { renderDrawing } from './render';
import { AWARDS, cardAwards, graphemes, headline, podium } from './results';
import { GREETINGS, type Festive } from './season';

export * from './results';

/**
 * The results picture people share: the drawing of the game as the hero, the
 * podium, a couple of awards and where to play, on the game's own indigo.
 *
 * 1080×1350 (4:5): the one size that shows near full width in a WhatsApp chat
 * and an Instagram feed and is not cropped in Slack or Discord. It is laid out
 * in phone-sized units (450 wide) and drawn 2.4× larger, so the house tokens
 * (3px outlines, 22px corners, 14px names) look on the picture the way they
 * look on a phone.
 *
 * Everything on it is drawn here or comes from this origin, so the canvas is
 * never tainted and always exports.
 *
 * A festive game (lib/season.ts) gets the festival's dressing, drawn with
 * paths like the rest: for Diwali, fairy lights across the top, a row of
 * lit diyas above the footer and a greeting stuck on by the headline.
 */
const CARD_W = 1080;
const CARD_H = 1350;
const W = 450;
const S = CARD_W / W;
const H = CARD_H / S;
const PAD = 24;

// Tokens from index.css.
const INDIGO = '#4231e0';
const INK = '#1e1b4b';
const INK_SOFT = '#57537f';
const PAPER = '#ffffff';
const YELLOW = '#ffd23f';
/** Muted text on indigo, as under the podium in the game. */
const LAVENDER = '#d5d2ff';
/** Diwali's warm accents: the house tangerine and yellows, with marigold and clay between. */
const TANGERINE = '#ff8a3d';
const MARIGOLD = '#ffb12e';
const WARM_WHITE = '#fff4c7';
const CLAY = '#e0703f';
const CLAY_DARK = '#a8441d';

/** The wordmark as components/Logo.tsx draws it: a marker colour and a tilt per letter. */
const LOGO_COLORS = ['#ffd23f', '#2bd46e', '#ff5fa2', '#8fe3ff', '#ff8a3d', '#ffffff'];
const LOGO_TILTS = [-6, 4, -3, 7, -5, 3, -7];
const MEDALS = ['🥇', '🥈', '🥉'];

/** Names can be in any script, or all emoji: after the house fonts, the system's. */
const SYSTEM =
  'ui-rounded, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif, ' +
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';
const display = (weight: number, px: number) =>
  `${weight} ${px}px "Fredoka Variable", "Nunito Variable", ${SYSTEM}`;
const body = (weight: number, px: number) => `${weight} ${px}px "Nunito Variable", ${SYSTEM}`;
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/**
 * index.css's background tile (220 units square) as path data, rects as
 * paths: drawn rather than loaded, so no SVG image can taint the canvas.
 */
const DOODLES =
  'M23 34h20a5 5 0 0 1 5 5v24a5 5 0 0 1-5 5H23a5 5 0 0 1-5-5V39a5 5 0 0 1 5-5z' +
  'M48 42c11 0 11 18 0 18M27 26c-4-5 4-8 0-14M38 26c-4-5 4-8 0-14' +
  'M150 18v42a9 9 0 0 1-18 0V24a6 6 0 0 1 12 0v34' +
  'M92 84h46a10 10 0 0 1 10 10v18a10 10 0 0 1-10 10h-30l-12 11v-11h-4' +
  'a10 10 0 0 1-10-10V94a10 10 0 0 1 10-10z' +
  'M128 196l22-22 14 12 28-34M178 152h14v14';
/** The sticky note, which the tile turns 8° about (49, 153). */
const DOODLE_NOTE =
  'M30 130h38a4 4 0 0 1 4 4v38a4 4 0 0 1-4 4H30a4 4 0 0 1-4-4v-38a4 4 0 0 1 4-4z' +
  'M36 148h24M36 158h18';

/** How long the fonts and the mascot may take before the card is drawn without them. */
const ASSET_WAIT_MS = 1200;

const FOOTER_H = 44;
/** How far the caption sticker hangs below the drawing, shadow included. */
const CAPTION_DROP = 18;
/** Diwali: how far the lights push the wordmark down, and the band the diyas stand in. */
const LIGHTS_ROOM = 10;
const DIYAS_ROOM = 24;

/** The podium: small under a drawing, roomy in its place, big when it is all there is. */
interface PodiumSize {
  /** Disc sizes: the winner's, and everyone else's. */
  win: number;
  other: number;
  /** How much higher the winner stands. */
  raise: number;
  /** Room above the winner's disc for the crown. */
  crownRoom: number;
  name: number;
  score: number;
  /** From one column's centre to the next. */
  col: number;
}
const PODIUM_SMALL: PodiumSize = {
  win: 44, other: 38, raise: 8, crownRoom: 14, name: 13.5, score: 11.5, col: 138,
};
const PODIUM_ROOMY: PodiumSize = {
  win: 76, other: 62, raise: 14, crownRoom: 22, name: 17, score: 14, col: 140,
};
const PODIUM_BIG: PodiumSize = {
  win: 96, other: 78, raise: 18, crownRoom: 30, name: 19, score: 15, col: 140,
};

interface ChipSize { h: number; emoji: number; title: number; detail: number; pad: number }
const CHIP_SMALL: ChipSize = { h: 36, emoji: 17, title: 12.5, detail: 11, pad: 9 };
const CHIP_ROOMY: ChipSize = { h: 50, emoji: 26, title: 16, detail: 13.5, pad: 12 };

interface Chip { emoji: string; title: string; name: string; value: string }

interface Parts {
  title: string;
  best: BestDrawing | null;
  art: CanvasImageSource | null;
  top: SummaryPlayer[];
  chips: Chip[];
  mascot: HTMLImageElement | null;
  festive: Festive;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * The picture for a finished game, as a PNG. `drawing` is the drawing of the
 * game as renderDrawing made it (the results screen replays it once and
 * passes it in), or null for a picture without it; left out, it is replayed
 * here from `summary.best`. Without a drawing (none, or one too slow to
 * replay), the picture is laid out as for a game where nothing was drawn.
 * `festive` dresses it for a festival.
 */
export async function renderShareCard(input: {
  summary: GameSummary;
  youId: string | null;
  drawing?: HTMLCanvasElement | null;
  festive?: Festive;
}): Promise<Blob> {
  const { summary, youId } = input;
  const festive = input.festive ?? null;
  const title = headline(summary, youId);
  const top = podium(summary);
  const names = new Map(summary.players.map((p) => [p.id, p.name]));
  const chips = cardAwards(summary).map(
    (a): Chip => ({
      emoji: AWARDS[a.id].emoji,
      title: AWARDS[a.id].title,
      name: names.get(a.playerId) ?? '',
      value: AWARDS[a.id].value(a.value),
    }),
  );
  // Everything the card will write, so the font subsets it needs (accented
  // names pull in latin-ext) load before drawing: a canvas never repaints.
  const sample = [
    'Drawdle Play free at drawdle.in Draw badly. Guess wildly. Laugh loudly.',
    '0123456789 points “”…',
    festive ? GREETINGS[festive] : '',
    title,
    summary.best ? `${summary.best.word} drawn by ${summary.best.drawerName}` : '',
    ...top.map((p) => p.name),
    ...chips.map((c) => `${c.title} ${c.name} ${c.value}`),
  ].join(' ');

  // Fonts and the mascot load while the drawing replays, if it is replayed here.
  const assets = Promise.all([
    fontsFor(sample),
    Promise.race([loadMascot(), wait(ASSET_WAIT_MS).then(() => null)]),
  ]);
  const made =
    input.drawing === undefined && summary.best
      ? await renderDrawing(summary.best.strokes, 1200, 900).catch(() => null)
      : null;
  const art = input.drawing ?? made;
  const best = art ? summary.best : null;
  try {
    const [, mascot] = await assets;
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No canvas to draw the share card on');
      ctx.scale(S, S);
      paint(ctx, { title, best, art, top, chips, mascot, festive });
      return await toPng(canvas);
    } finally {
      // iOS keeps a canvas's memory until it is shrunk, and caps the total.
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    if (made) {
      made.width = 0;
      made.height = 0;
    }
  }
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The share card could not be encoded'))),
      'image/png',
    );
  });
}

/**
 * The house fonts for these characters. A canvas never redraws when a font
 * arrives late, so they come first; but not for long: offline, the system's
 * fonts will do.
 */
async function fontsFor(sample: string): Promise<void> {
  try {
    const fonts = document.fonts;
    if (typeof fonts?.load !== 'function') return;
    await Promise.race([
      Promise.all([
        fonts.load('700 40px "Fredoka Variable"', sample),
        fonts.load('800 20px "Nunito Variable"', sample),
      ]),
      wait(ASSET_WAIT_MS),
    ]);
  } catch {
    /* draw with what there is */
  }
}

let mascotImage: Promise<HTMLImageElement | null> | null = null;

/** The mascot for the wordmark, decoded once and kept; null if it will not load. */
function loadMascot(): Promise<HTMLImageElement | null> {
  mascotImage ??= new Promise((resolve) => {
    const img = new Image();
    // It is same-origin. Asking for CORS anyway means a copy served from
    // anywhere else fails to load, rather than loading and tainting the canvas.
    img.crossOrigin = 'anonymous';
    img.src = new URL('../assets/mascot.png', import.meta.url).href;
    img.decode().then(
      () => resolve(img),
      () => {
        mascotImage = null; // try again next time
        resolve(null);
      },
    );
  });
  return mascotImage;
}

/* ---------------------------------------------------------------- layout */

function paint(ctx: CanvasRenderingContext2D, p: Parts): void {
  background(ctx);
  const inner = W - 2 * PAD;
  const diwali = p.festive === 'diwali';
  const greeting = p.festive ? GREETINGS[p.festive] : null;

  // Diwali's lights hang across the top, with the wordmark moved down clear of them.
  if (diwali) fairyLights(ctx);
  const logoTop = 14 + (diwali ? LIGHTS_ROOM : 0);
  logo(ctx, p.mascot, logoTop);
  let y = logoTop + 42 + 6;
  const head = fitHeadline(ctx, p.title, inner);
  drawHeadline(ctx, head, y);
  y += head.lines.length * head.px * 1.12;

  const footTop = H - 10 - FOOTER_H;
  footer(ctx, footTop);
  // Diwali's diyas stand in a row of their own on top of the footer.
  const floor = diwali ? footTop - DIYAS_ROOM : footTop;
  if (diwali) diyas(ctx, footTop - 2);

  if (p.best) {
    // The drawing is the hero: it takes whatever height the rest leaves.
    const chipsH = p.chips.length ? 8 + CHIP_SMALL.h + 3 : 0;
    const below = CAPTION_DROP + 10 + podiumHeight(PODIUM_SMALL) + chipsH + 10;
    // The greeting gets a band of its own above the drawing: stuck on the
    // panel's corner it would hide whatever was drawn there.
    const gw = greeting ? greetingWidth(ctx, greeting) : 0;
    const rise = greeting ? greetingRise(gw) : 0;
    const headEnd = y;
    if (greeting) y += 2 * rise - 14;
    const room = floor - y - 12 - below;
    const tallest = ((inner - 6) * 3) / 4 + 6;
    const ph = Math.max(120, Math.min(room, tallest));
    // Height the drawing cannot use (it is as wide as it goes) spreads into the gaps.
    const extra = Math.max(0, room - ph) / (p.chips.length ? 4 : 3);

    y += 12 + extra;
    const pw = ((ph - 6) * 4) / 3 + 6;
    const px = (W - pw) / 2;
    drawingPanel(ctx, p.art, px, y, pw, ph);
    if (greeting) {
      // Over the drawing's top corner, in its band: it overlaps the panel's
      // outline at most, never the drawing.
      greetingSticker(ctx, greeting, Math.min(px + pw, W - 8 - gw / 2), headEnd + 4 + rise, gw);
    }
    // The caption may stick out past the drawing: the word is the joke.
    caption(ctx, p.best, W / 2, y + ph, inner);
    y += ph + CAPTION_DROP + 10 + extra;
    drawPodium(ctx, p.top, y, PODIUM_SMALL);
    y += podiumHeight(PODIUM_SMALL) + 8 + extra;
    if (p.chips.length) drawChips(ctx, p.chips, y, CHIP_SMALL, false);
    return;
  }

  // Nothing was drawn: the podium takes the space, and the awards get room.
  if (greeting) {
    // Under the headline, in a row of its own as tall as the tilted sticker and its shadow.
    const gw = greetingWidth(ctx, greeting);
    const rise = greetingRise(gw);
    greetingSticker(ctx, greeting, W / 2, y + 6 + rise, gw);
    y += 6 + 2 * rise + 3;
  }
  const z = p.chips.length ? PODIUM_ROOMY : PODIUM_BIG;
  const n = p.chips.length;
  const chipsH = n ? n * CHIP_ROOMY.h + (n - 1) * 12 + 3 : 0;
  const gap = Math.max(12, (floor - y - podiumHeight(z) - chipsH) / (n ? 3 : 2));
  y += gap;
  drawPodium(ctx, p.top, y, z);
  y += podiumHeight(z) + gap;
  if (n) drawChips(ctx, p.chips, y, CHIP_ROOMY, true);
}

/* ------------------------------------------------------------ the pieces */

/** The page's indigo with its faint office doodles. */
function background(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = INDIGO;
  ctx.fillRect(0, 0, W, H);
  try {
    const doodles = new Path2D(DOODLES);
    const note = new Path2D(DOODLE_NOTE);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let ty = 0; ty < H; ty += 220) {
      for (let tx = 0; tx < W; tx += 220) {
        ctx.save();
        ctx.translate(tx, ty);
        ctx.stroke(doodles);
        ctx.translate(49, 153);
        ctx.rotate(rad(-8));
        ctx.translate(-49, -153);
        ctx.stroke(note);
        ctx.restore();
      }
    }
    ctx.restore();
  } catch {
    /* plain indigo is fine too */
  }
}

/** The mascot, then each letter in its marker colour and tilt, inked, with one hard shadow. */
function logo(ctx: CanvasRenderingContext2D, mascot: HTMLImageElement | null, top: number): void {
  const fs = 42;
  ctx.font = display(700, fs);
  ctx.textBaseline = 'alphabetic';
  const letters = [...'Drawdle'];
  // The page spaces the letters 0.01em apart.
  const widths = letters.map((ch) => ctx.measureText(ch).width + fs * 0.01);
  const mh = fs * 0.8;
  const mw = mascot ? (mh * mascot.naturalWidth) / Math.max(1, mascot.naturalHeight) : 0;
  const gap = mascot ? fs * 0.14 : 0;
  let x = (W - (mw + gap + widths.reduce((a, b) => a + b, 0))) / 2;
  const baseline = top + fs * 0.8;
  // Where each letter turns (its box's middle), and where the mascot centres.
  const middle = baseline - fs * 0.36;

  ctx.save();
  // The CSS drop-shadow, under everything. Canvas shadows ignore the
  // transform, so the offset is in real pixels.
  ctx.shadowColor = INK;
  ctx.shadowOffsetX = 3 * S;
  ctx.shadowOffsetY = 3 * S;
  if (mascot) {
    ctx.save();
    ctx.translate(x + mw / 2, middle);
    ctx.rotate(rad(-6));
    ctx.drawImage(mascot, -mw / 2, -mh / 2, mw, mh);
    ctx.restore();
    x += mw + gap;
  }
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4.5;
  ctx.strokeStyle = INK;
  letters.forEach((ch, i) => {
    const w = widths[i] ?? 0;
    ctx.save();
    ctx.translate(x + w / 2, middle);
    ctx.rotate(rad(LOGO_TILTS[i % LOGO_TILTS.length] ?? 0));
    // Stroke, then fill over it: the page's paint-order: stroke fill.
    ctx.strokeText(ch, 0, baseline - middle);
    ctx.fillStyle = LOGO_COLORS[i % LOGO_COLORS.length] ?? PAPER;
    ctx.fillText(ch, 0, baseline - middle);
    ctx.restore();
    x += w;
  });
  ctx.restore();
}

interface Headline { px: number; lines: string[] }

/** One line if it fits big enough, else two, then smaller; never off the card. */
function fitHeadline(ctx: CanvasRenderingContext2D, text: string, max: number): Headline {
  for (let px = 30; px >= 24; px--) {
    ctx.font = display(700, px);
    if (fits(ctx, text, max)) return { px, lines: [text] };
  }
  for (let px = 28; px >= 20; px--) {
    ctx.font = display(700, px);
    const lines = wrap(ctx, text, max);
    if (lines.length <= 2 && lines.every((l) => fits(ctx, l, max))) return { px, lines };
  }
  ctx.font = display(700, 20);
  const [first = '', ...rest] = wrap(ctx, text, max);
  const lines = [ellipsize(ctx, first, max)];
  if (rest.length) lines.push(ellipsize(ctx, rest.join(' '), max));
  return { px: 20, lines };
}

function drawHeadline(ctx: CanvasRenderingContext2D, head: Headline, top: number): void {
  ctx.save();
  ctx.font = display(700, head.px);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = PAPER;
  // White with a hard ink shadow, like the guide pages' headings.
  ctx.shadowColor = INK;
  ctx.shadowOffsetX = 2 * S;
  ctx.shadowOffsetY = 2 * S;
  head.lines.forEach((line, i) => ctx.fillText(line, W / 2, top + head.px * (0.82 + i * 1.12)));
  ctx.restore();
}

/**
 * Paper behind the drawing (it is transparent, like the live canvas), then
 * the drawing, inside the outline.
 */
function drawingPanel(
  ctx: CanvasRenderingContext2D,
  art: CanvasImageSource | null,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  sticker(ctx, x, y, w, h, 22, PAPER, 3, 4);
  if (!art) return;
  ctx.save();
  roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 19);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(art, x + 3, y + 3, w - 6, h - 6);
  ctx.restore();
  // Ink over the clipped edge again, so the drawing never softens the outline.
  outline(ctx, x, y, w, h, 22, 3);
}

/** "“cat” drawn by Asha" and the likes, on a yellow sticker across the drawing's bottom edge. */
function caption(
  ctx: CanvasRenderingContext2D,
  best: BestDrawing,
  cx: number,
  cy: number,
  maxW: number,
): void {
  const px = 14.5;
  const pad = 14;
  const h = 30;
  ctx.font = display(600, px);
  const likes = best.likes > 0 ? `👍 ${best.likes}` : '';
  const likesW = likes ? ctx.measureText(likes).width + 12 : 0;
  const text = captionText(ctx, best.word, best.drawerName, maxW - 2 * pad - likesW);
  const textW = ctx.measureText(text).width;
  const w = textW + likesW + 2 * pad;
  const x = cx - w / 2;
  sticker(ctx, x, cy - h / 2, w, h, 14, YELLOW, 3, 3);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  const base = cy + px * 0.36;
  ctx.fillText(text, x + pad, base);
  if (likes) ctx.fillText(likes, x + pad + textW + 12, base);
}

/** The word is the joke, so the name gives way first. */
function captionText(
  ctx: CanvasRenderingContext2D,
  word: string,
  name: string,
  max: number,
): string {
  const full = `“${word}” drawn by ${name}`;
  if (fits(ctx, full, max)) return full;
  const left = max - ctx.measureText(`“${word}” drawn by `).width;
  if (left >= 56) return `“${word}” drawn by ${ellipsize(ctx, name, left)}`;
  const who = ellipsize(ctx, name, 56);
  const room = max - ctx.measureText(`“” drawn by ${who}`).width;
  return `“${ellipsize(ctx, word, room)}” drawn by ${who}`;
}

function podiumHeight(z: PodiumSize): number {
  return z.crownRoom + z.win + z.raise + 6 + z.name * 0.75 + z.score * 1.6;
}

/**
 * Second, first, third, as on a real podium; the winner bigger, raised and
 * crowned. Crowns and medals take points: a game that ended before anyone
 * scored has no winner to celebrate.
 */
function drawPodium(
  ctx: CanvasRenderingContext2D,
  top: SummaryPlayer[],
  y: number,
  z: PodiumSize,
): void {
  const order = [top[1], top[0], top[2]].filter((p): p is SummaryPlayer => p !== undefined);
  const mid = W / 2;
  const centres =
    order.length === 3
      ? [mid - z.col, mid, mid + z.col]
      : order.length === 2
        ? [mid - z.col * 0.6, mid + z.col * 0.6]
        : [mid];
  const nameMax =
    order.length === 3 ? z.col - 12 : order.length === 2 ? z.col * 1.2 - 12 : W - 2 * PAD;
  order.forEach((p, i) => {
    const cx = centres[i] ?? mid;
    const scored = p.score > 0;
    const first = p.rank === 1 && scored;
    const d = first ? z.win : z.other;
    const bottom = y + z.crownRoom + z.win + (first ? 0 : z.raise);
    const cy = bottom - d / 2;
    disc(ctx, p.avatar, cx, cy, d);
    if (first) {
      ctx.save();
      ctx.translate(cx, cy - d / 2 - d * 0.1);
      ctx.rotate(rad(-12));
      emoji(ctx, '👑', 0, 0, d * 0.46);
      ctx.restore();
    }
    const medal = scored ? MEDALS[p.rank - 1] : undefined;
    if (medal) emoji(ctx, medal, cx + d * 0.34, cy + d * 0.34, d * 0.5);

    const nameY = bottom + 6 + z.name * 0.75;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = body(800, z.name);
    ctx.fillStyle = PAPER;
    ctx.fillText(ellipsize(ctx, p.name, nameMax), cx, nameY);
    ctx.font = body(700, z.score);
    ctx.fillStyle = LAVENDER;
    ctx.fillText(`${p.score} ${p.score === 1 ? 'point' : 'points'}`, cx, nameY + z.score * 1.3);
  });
}

/** An avatar as the game shows it: the emoji on its backdrop colour, in an ink ring. */
function disc(
  ctx: CanvasRenderingContext2D,
  avatar: number,
  cx: number,
  cy: number,
  d: number,
): void {
  const k = avatarSlot(avatar);
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
  ctx.fillStyle = BACKDROPS[k] ?? PAPER;
  ctx.fill();
  // Inside the disc, as a CSS border is.
  const ring = d >= 56 ? 3 : 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, d / 2 - ring / 2, 0, Math.PI * 2);
  ctx.lineWidth = ring;
  ctx.strokeStyle = INK;
  ctx.stroke();
  emoji(ctx, AVATARS[k] ?? '', cx, cy, d * 0.58);
}

/** The award chips: one row under a drawing, a column of bigger ones without. */
function drawChips(
  ctx: CanvasRenderingContext2D,
  chips: Chip[],
  y: number,
  z: ChipSize,
  stacked: boolean,
): void {
  const inner = W - 2 * PAD;
  const maxW = stacked || chips.length === 1 ? Math.min(inner, 320) : (inner - 10) / 2;
  const widths = chips.map((c) => chipWidth(ctx, c, z, maxW));
  if (stacked) {
    chips.forEach((c, i) => {
      const w = widths[i] ?? 0;
      drawChip(ctx, c, (W - w) / 2, y + i * (z.h + 12), w, z);
    });
    return;
  }
  let x = (W - widths.reduce((a, b) => a + b, 0) - 10 * (chips.length - 1)) / 2;
  chips.forEach((c, i) => {
    const w = widths[i] ?? 0;
    drawChip(ctx, c, x, y, w, z);
    x += w + 10;
  });
}

/** Where a chip's text starts, after its emoji. */
const chipText = (z: ChipSize) => z.pad + z.emoji + z.pad * 0.7;

function chipWidth(ctx: CanvasRenderingContext2D, c: Chip, z: ChipSize, maxW: number): number {
  ctx.font = display(600, z.title);
  const titleW = ctx.measureText(c.title).width;
  ctx.font = body(800, z.detail);
  const detailW = ctx.measureText(`${c.name} · ${c.value}`).width;
  return Math.min(maxW, chipText(z) + Math.max(titleW, detailW) + z.pad);
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  c: Chip,
  x: number,
  y: number,
  w: number,
  z: ChipSize,
): void {
  sticker(ctx, x, y, w, z.h, 12, PAPER, 2.5, 3);
  emoji(ctx, c.emoji, x + z.pad + z.emoji / 2, y + z.h / 2, z.emoji);
  const tx = x + chipText(z);
  const room = w - chipText(z) - z.pad;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  ctx.font = display(600, z.title);
  ctx.fillText(ellipsize(ctx, c.title, room), tx, y + z.h * 0.44);
  ctx.fillStyle = INK_SOFT;
  ctx.font = body(800, z.detail);
  const tail = ` · ${c.value}`;
  const whole = `${c.name}${tail}`;
  // Measured whole, as chipWidth did: the name and the tail measured apart can
  // come out a hair wider, which would shorten a name that fits. When it does
  // not fit, the value is the point and the name gives way.
  const detail = fits(ctx, whole, room)
    ? whole
    : `${ellipsize(ctx, c.name, room - ctx.measureText(tail).width)}${tail}`;
  ctx.fillText(detail, tx, y + z.h * 0.8);
}

/** Where to play, big and yellow enough to read in a chat thumbnail, and the tagline. */
function footer(ctx: CanvasRenderingContext2D, top: number): void {
  const cta = 'Play free at drawdle.in';
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = display(700, 22);
  ctx.shadowColor = INK;
  ctx.shadowOffsetX = 2 * S;
  ctx.shadowOffsetY = 2 * S;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = INK;
  ctx.strokeText(cta, W / 2, top + 20);
  ctx.fillStyle = YELLOW;
  ctx.fillText(cta, W / 2, top + 20);
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.font = body(800, 12.5);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fillText('Draw badly. Guess wildly. Laugh loudly.', W / 2, top + 39);
}

/* ---------------------------------------------------------------- Diwali */

const GREETING_PX = 15.5;
const GREETING_H = 29;
const GREETING_TILT = rad(5);
/** The fairy lights' bulbs, in turn: warm colours only, as a real string's are. */
const BULBS = [YELLOW, TANGERINE, WARM_WHITE, MARIGOLD];

/**
 * A warm light around (x, y), fading out by `r`. Strong at the heart: a thin
 * warm wash over indigo only greys it.
 */
function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255, 214, 120, ${alpha})`);
  g.addColorStop(0.4, `rgba(255, 184, 77, ${alpha * 0.45})`);
  g.addColorStop(1, 'rgba(255, 184, 77, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
}

/**
 * A string of fairy lights across the top in three loops, pinned just above
 * the card's edge. The bulbs hang at the wire's slope, as a real string's
 * do, and glow on the indigo. They stay in the band LIGHTS_ROOM makes.
 */
function fairyLights(ctx: CanvasRenderingContext2D): void {
  const loops = 3;
  const from = -8;
  const span = (W - 2 * from) / loops;
  const pin = -1;
  const sag = 10;
  const perLoop = 6;
  const bulbs: { x: number; y: number; tilt: number }[] = [];
  for (let i = 0; i < loops; i++) {
    for (let j = 0; j < perLoop; j++) {
      // Each loop is a parabola from pin to pin.
      const t = (j + 0.5) / perLoop;
      const slope = (4 * sag * (1 - 2 * t)) / span;
      bulbs.push({ x: from + (i + t) * span, y: pin + 4 * sag * t * (1 - t), tilt: Math.atan(slope) });
    }
  }
  ctx.save();
  // The light first, so no bulb's glow washes over its neighbour.
  for (const b of bulbs) glow(ctx, b.x - 7 * Math.sin(b.tilt), b.y + 7 * Math.cos(b.tilt), 12, 0.85);
  ctx.beginPath();
  ctx.moveTo(from, pin);
  for (let i = 0; i < loops; i++) {
    const x0 = from + i * span;
    ctx.quadraticCurveTo(x0 + span / 2, pin + 2 * sag, x0 + span, pin);
  }
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  bulbs.forEach((b, i) => bulb(ctx, b.x, b.y, b.tilt, BULBS[i % BULBS.length] ?? YELLOW));
  ctx.restore();
}

/** One bulb on the wire at (x, y): an ink cap, then the glass, catching the light. */
function bulb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tilt: number,
  colour: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.fillStyle = INK;
  roundRect(ctx, -1.9, -0.6, 3.8, 3.9, 0.9);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 7, 3.1, 4.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-1.1, 5.7, 0.8, 1.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.fill();
  ctx.restore();
}

/** Lit diyas in a row across the card, standing on `base`. */
function diyas(ctx: CanvasRenderingContext2D, base: number): void {
  const n = 7;
  const w = 20;
  const step = (W - 2 * PAD - w) / (n - 1);
  const xs = Array.from({ length: n }, (_, i) => PAD + w / 2 + i * step);
  ctx.save();
  for (const x of xs) glow(ctx, x, base - w * 0.7, w * 0.9, 0.85);
  for (const x of xs) diya(ctx, x, base, w);
  ctx.restore();
}

/**
 * A clay lamp, `w` wide, seen from the front: a bowl painted with dots, the
 * oil at its rim and the flame on its wick.
 */
function diya(ctx: CanvasRenderingContext2D, cx: number, base: number, w: number): void {
  const depth = w * 0.44;
  const rim = w * 0.12;
  ctx.save();
  ctx.translate(cx, base - depth);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = INK;

  ctx.beginPath();
  ctx.moveTo(-w / 2, 0);
  ctx.bezierCurveTo(-w / 2, depth * 0.8, -w * 0.3, depth, 0, depth);
  ctx.bezierCurveTo(w * 0.3, depth, w / 2, depth * 0.8, w / 2, 0);
  ctx.closePath();
  ctx.fillStyle = CLAY;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = YELLOW;
  for (const k of [-1, 0, 1]) {
    ctx.beginPath();
    ctx.arc(k * w * 0.22, depth * (k ? 0.48 : 0.6), w * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, rim, 0, 0, Math.PI * 2);
  ctx.fillStyle = CLAY_DARK;
  ctx.fill();
  ctx.stroke();

  flame(ctx, 0, rim * 0.2, w * 0.62);
  ctx.restore();
}

/** A flame `h` tall rising from (x, y): marigold, white-hot at its heart, inked. */
function flame(ctx: CanvasRenderingContext2D, x: number, y: number, h: number): void {
  const drop = (k: number) => {
    const fh = h * k;
    const fw = h * 0.42 * k;
    ctx.beginPath();
    ctx.moveTo(x, y - fh);
    ctx.bezierCurveTo(x + fw * 0.2, y - fh * 0.66, x + fw * 0.56, y - fh * 0.45, x + fw * 0.5, y - fh * 0.2);
    ctx.bezierCurveTo(x + fw * 0.45, y + fh * 0.02, x - fw * 0.45, y + fh * 0.02, x - fw * 0.5, y - fh * 0.2);
    ctx.bezierCurveTo(x - fw * 0.56, y - fh * 0.45, x - fw * 0.2, y - fh * 0.66, x, y - fh);
    ctx.closePath();
  };
  drop(1);
  ctx.fillStyle = MARIGOLD;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = INK;
  ctx.stroke();
  drop(0.55);
  ctx.fillStyle = WARM_WHITE;
  ctx.fill();
}

/** How wide the greeting's sticker is. */
function greetingWidth(ctx: CanvasRenderingContext2D, text: string): number {
  ctx.font = display(700, GREETING_PX);
  return ctx.measureText(text).width + 26;
}

/** How far the greeting's sticker, `w` wide and askew, reaches above its centre. */
function greetingRise(w: number): number {
  return (w / 2) * Math.sin(GREETING_TILT) + (GREETING_H / 2) * Math.cos(GREETING_TILT);
}

/** The festival's greeting on a tangerine sticker, slapped on askew, centred on (cx, cy). */
function greetingSticker(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  w: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(GREETING_TILT);
  sticker(ctx, -w / 2, -GREETING_H / 2, w, GREETING_H, 14, TANGERINE, 2.5, 3);
  ctx.font = display(700, GREETING_PX);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  ctx.fillText(text, 0, GREETING_PX * 0.36);
  ctx.restore();
}

/* --------------------------------------------------------------- drawing */

/** A rounded rectangle path, with arcTo: roundRect() is too new for some phones still in use. */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** An outline inside the box, as a CSS border is. */
function outline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  line: number,
): void {
  roundRect(ctx, x + line / 2, y + line / 2, w - line, h - line, r - line / 2);
  ctx.lineWidth = line;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/** The house sticker: a hard ink shadow, then the fill, inside an ink outline. */
function sticker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  line: number,
  shadow: number,
): void {
  roundRect(ctx, x + shadow, y + shadow, w, h, r);
  ctx.fillStyle = INK;
  ctx.fill();
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  outline(ctx, x, y, w, h, r, line);
}

/** An emoji centred on its own ink: emoji fonts sit high or low in their line boxes. */
function emoji(ctx: CanvasRenderingContext2D, ch: string, cx: number, cy: number, px: number): void {
  ctx.font = `${px}px ${EMOJI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Colour emoji ignore this; a monochrome fallback font draws in ink.
  ctx.fillStyle = INK;
  const m = ctx.measureText(ch);
  const up = m.actualBoundingBoxAscent;
  const down = m.actualBoundingBoxDescent;
  const measured = Number.isFinite(up) && Number.isFinite(down) && up + down > 0;
  ctx.fillText(ch, cx, measured ? cy + (up - down) / 2 : cy + px * 0.35);
}

/** Greedy word wrap at `max` wide; a single word longer than that gets a line of its own. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > max) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Whether `text` is at most `max` wide. Half a unit of slack: widths that were
 * added up and taken apart again can miss by a rounding error, and a name
 * shortened over that would be a visible mistake.
 */
function fits(ctx: CanvasRenderingContext2D, text: string, max: number): boolean {
  return ctx.measureText(text).width <= max + 0.5;
}

/** The longest start of `text` that fits `max` with an ellipsis, cut between whole characters. */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (fits(ctx, text, max)) return text;
  const g = graphemes(text);
  let lo = 0;
  let hi = g.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fits(ctx, `${g.slice(0, mid).join('').trimEnd()}…`, max)) lo = mid;
    else hi = mid - 1;
  }
  return `${g.slice(0, lo).join('').trimEnd()}…`;
}
