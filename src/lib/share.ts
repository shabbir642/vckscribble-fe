/**
 * Getting the results picture out of the browser and into a chat, by
 * whatever this device can do: the OS share sheet with the picture, the
 * picture on the clipboard, a download, or an app's share link (which only
 * ever carries text).
 *
 * Sharing and clipboard writes need the tap that asked for them, and Safari
 * forgets the tap at the first await. So everything that needs one calls the
 * browser before any await: prepare the File beforehand, then call these
 * straight from the handler.
 */

/** Where public posts point: a live room code has no place on X or LinkedIn. */
export const SITE_URL = 'https://drawdle.in';

/**
 * A touch-first handheld: phones, and tablets, which share through the same
 * OS sheet. A touchscreen laptop has a fine primary pointer, and a big touch
 * display a long short side, so both count as desktops.
 */
export function isPhone(): boolean {
  try {
    return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 1024;
  } catch {
    return false;
  }
}

/** True only when the browser says it can share this very file. */
export function canShareFiles(file: File): boolean {
  try {
    return (
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] }) === true
    );
  } catch {
    return false;
  }
}

/** iPhone and iPad, including iPadOS, which asks for desktop sites as a Mac. */
export function isIOS(): boolean {
  try {
    const ua = navigator.userAgent;
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  } catch {
    return false;
  }
}

const isAbort = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';

/** When the open share sheet was asked for; 0 when none is open. */
let sharingSince = 0;
/**
 * A share sheet covers the page, so a tap while one is "open" is a double tap
 * or a share whose promise never settled (a WebKit bug that a second call
 * makes worse). After this long it is the latter, and a new tap gets through.
 */
const STUCK_MS = 20_000;

/**
 * The OS share sheet with the picture: WhatsApp, Instagram, Slack, Discord,
 * Teams and the rest all take it from there. Call it synchronously from the
 * tap, with the File already made.
 *
 * iOS gets the file alone: WebKit drops the files when text comes with them
 * (webkit.org/b/251500), and the picture carries the address in its footer.
 * Elsewhere the text travels along, as the picture's caption in WhatsApp.
 * A tap while the sheet is already open is ignored ('cancelled').
 */
export function shareFile(file: File, text: string): Promise<'shared' | 'cancelled' | 'failed'> {
  if (sharingSince && Date.now() - sharingSince < STUCK_MS) return Promise.resolve('cancelled');
  if (typeof navigator.share !== 'function') return Promise.resolve('failed');
  const data: ShareData = isIOS() ? { files: [file] } : { files: [file], text };
  let shared: Promise<void>;
  try {
    shared = navigator.share(data);
  } catch (e) {
    return Promise.resolve(isAbort(e) ? 'cancelled' : 'failed');
  }
  const asked = Date.now();
  sharingSince = asked;
  const settle = <T>(result: T): T => {
    if (sharingSince === asked) sharingSince = 0;
    return result;
  };
  return shared.then(
    () => settle('shared' as const),
    (e: unknown) => settle(isAbort(e) ? ('cancelled' as const) : ('failed' as const)),
  );
}

/** Whether a picture can go on the clipboard here (secure pages, recent browsers). */
export function canCopyImage(): boolean {
  try {
    if (!window.isSecureContext || typeof ClipboardItem === 'undefined') return false;
    if (typeof navigator.clipboard?.write !== 'function') return false;
    // supports() is newer than ClipboardItem; PNG is the one image type all of them take.
    return typeof ClipboardItem.supports === 'function' ? ClipboardItem.supports('image/png') : true;
  } catch {
    return false;
  }
}

/** The item says image/png, so the blob says so too, whatever it was labelled. */
const asPng = (b: Blob) => (b.type === 'image/png' ? b : new Blob([b], { type: 'image/png' }));

/**
 * Put the picture on the clipboard. The ClipboardItem is made right here, in
 * the tap, with the picture allowed to still be on its way (a promise):
 * Safari refuses a clipboard write that only starts after an await.
 */
export function copyImage(blob: Blob | Promise<Blob>): Promise<boolean> {
  const png = blob instanceof Blob ? asPng(blob) : blob.then(asPng);
  // If the write never starts, a failing picture must not surface as an
  // unhandled rejection: the caller already hears false.
  if (!(png instanceof Blob)) void png.catch(() => {});
  try {
    const item = new ClipboardItem({ 'image/png': png });
    return navigator.clipboard.write([item]).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * The old way to copy, for plain http (a LAN address), where the async
 * clipboard does not exist. It must run inside the tap.
 */
function copyWithTextarea(text: string): boolean {
  const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  try {
    ta.select();
    // iOS selects nothing with select() alone.
    ta.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
    // Selecting moved focus into the textarea: hand it back, or a dialog's
    // focus trap would lose its place.
    back?.focus({ preventScroll: true });
  }
}

/** Copy text, as InviteLink does: the async clipboard, else the textarea. */
export function copyText(text: string): Promise<boolean> {
  if (typeof navigator.clipboard?.writeText !== 'function') {
    return Promise.resolve(copyWithTextarea(text));
  }
  try {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => copyWithTextarea(text),
    );
  } catch {
    return Promise.resolve(copyWithTextarea(text));
  }
}

/** Save the picture as a file (iOS asks first, then puts it in Files). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked later, not now: revoking at once can cancel the download in
  // Safari and Firefox, and iOS first asks whether to download at all.
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

export type TargetId = 'whatsapp' | 'whatsapp-web' | 'telegram' | 'x' | 'linkedin' | 'email';

/**
 * An app's own share link. These carry text, never a picture. `text` is the
 * whole message (shareText's, with `url` in it); the link is added where an
 * app wants it on its own and left out of the text there, so it never shows
 * twice. Every value goes through encodeURIComponent: spaces as %20, which
 * mail apps need (they read + literally).
 */
export function targetHref(id: TargetId, text: string, url: string): string {
  const enc = encodeURIComponent;
  const message = text.replace(/\r\n?/g, '\n');
  const whole = url && !message.includes(url) ? `${message}\n${url}` : message;
  // The text without the link, for apps that take the link separately.
  const bare = url ? message.split(url).join('').replace(/[ \t]+$/gm, '').trim() : message;
  const lines = message.split('\n');
  switch (id) {
    case 'whatsapp':
      return `https://wa.me/?text=${enc(whole)}`;
    case 'whatsapp-web':
      // Straight to the chat picker: wa.me stops at an "Open app" page on desktops.
      return `https://web.whatsapp.com/send?text=${enc(whole)}`;
    case 'telegram': {
      // Telegram puts the link first, then the text: a line that only
      // introduced the link ("Join our next game:") would dangle, so it goes.
      const rest = url ? lines.filter((l) => !l.includes(url)) : lines;
      const said = rest.length > 0 && rest.length < lines.length ? rest.join('\n') : bare;
      return `https://t.me/share/url?url=${enc(url)}&text=${enc(said)}`;
    }
    case 'x':
      // X adds the link after the text, so "Play free with friends:" leads into it.
      return `https://x.com/intent/tweet?text=${enc(bare)}&url=${enc(url)}`;
    case 'linkedin':
      // LinkedIn ignores any text: the link alone.
      return `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`;
    case 'email': {
      const subject = lines.length > 1 ? (lines[0] ?? '').trim() : 'Our Drawdle game';
      return `mailto:?subject=${enc(subject)}&body=${enc(whole.replace(/\n/g, '\r\n'))}`;
    }
  }
}
