import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { GameSummary } from '../generated/contract';
import type { Festive } from '../lib/season';
import { roomInviteUrl } from '../lib/session';
import {
  SITE_URL,
  canCopyImage,
  canShareFiles,
  copyImage,
  copyText,
  downloadBlob,
  isPhone,
  shareFile,
  targetHref,
} from '../lib/share';
import { cardAlt, renderShareCard, shareText } from '../lib/shareCard';

/** What the results picture is called wherever it is saved or sent. */
export const CARD_FILE = 'drawdle-results.png';

/**
 * The results picture as a file, ready to share, copy or save. `drawing` is
 * the drawing of the game already replayed, or null for a picture without
 * one; left out, the picture replays it itself. `festive` dresses it for a
 * festival.
 */
export async function makeCardFile(
  summary: GameSummary,
  youId: string | null,
  drawing?: HTMLCanvasElement | null,
  festive: Festive = null,
): Promise<File> {
  const blob = await renderShareCard({ summary, youId, drawing, festive });
  return new File([blob], CARD_FILE, { type: 'image/png' });
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab inside a modal dialog: past its last control back to the first,
 * and the other way round. Call it from the dialog's own keydown.
 */
export function trapTab(e: ReactKeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Tab') return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0,
  );
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    e.preventDefault();
    return;
  }
  const at = document.activeElement;
  // From the heading (focusable, but not by Tab), Shift+Tab would leave.
  const inList = items.some((el) => el === at);
  if (e.shiftKey ? at === first || !inList : at === last) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
}

/**
 * What this device can do with the picture: a phone hands it to the OS share
 * sheet (where WhatsApp, Instagram, Slack and the rest all take it), a phone
 * that can't share files (Firefox on Android, in-app browsers) gets the apps'
 * share links, and a desktop copies it for pasting.
 */
export type ShareMode = 'native' | 'links' | 'desktop';

export function shareMode(): ShareMode {
  if (!isPhone()) return 'desktop';
  // canShare judges the file's type, not its contents: a stand-in answers for
  // the picture before it is made.
  const probe = new File([new Uint8Array([137, 80, 78, 71])], CARD_FILE, { type: 'image/png' });
  return canShareFiles(probe) ? 'native' : 'links';
}

/** A URL for the picture while the sheet shows it, revoked as soon as it doesn't. */
function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/** One line of feedback ("Copied"), gone after long enough to read it. */
function useStatus(): [string, (text: string) => void] {
  const [text, setText] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const say = useCallback((t: string) => {
    if (!alive.current) return;
    clearTimeout(timer.current);
    setText(t);
    // About 2 s; longer for a line that says what to do next.
    timer.current = setTimeout(() => setText(''), Math.max(2000, t.length * 60));
  }, []);
  return [text, say];
}

interface Props {
  summary: GameSummary;
  /** The festival the game is dressed for: its greeting opens the message. */
  festive: Festive;
  youId: string;
  roomCode: string;
  /** The picture, if it is already made. */
  file: File | null;
  /** Makes the picture, or hands over the one already being made. */
  card: () => Promise<File>;
  title: string;
  onClose: () => void;
  /** Where focus goes back to if whatever opened the sheet is gone or hidden by the time it closes. */
  returnFocus?: () => HTMLElement | null;
}

/**
 * Every way to get the results out, by device. Opened from the results screen
 * when the OS share sheet can't take the picture (or "More ways to share"),
 * and during the next game for the last one. Private chats get the room's
 * invite ("Join our next game"); public posts (X, LinkedIn) get the site.
 */
export function ShareSheet({
  summary,
  festive,
  youId,
  roomCode,
  file: given,
  card,
  title,
  onClose,
  returnFocus,
}: Props) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [mode] = useState(shareMode);
  const [imageClip] = useState(canCopyImage);
  const [file, setFile] = useState<File | null>(given);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [status, say] = useStatus();
  /** The picture on its way, for a clipboard write that can't wait for it. */
  const pending = useRef<Promise<File> | null>(null);
  const makeCard = useRef(card);
  makeCard.current = card;
  const url = useObjectUrl(file);

  useEffect(() => {
    if (given) setFile(given);
  }, [given]);

  useEffect(() => {
    if (file) return;
    let live = true;
    setFailed(false);
    const promise = makeCard.current();
    pending.current = promise;
    promise.then(
      (f) => live && setFile(f),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
    // Once per attempt: the owner's card() is the same picture every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Focus into the sheet; back to whatever opened it once it closes (after the
  // page behind is interactive again). If that is gone or hidden by then (on a
  // phone, the strip's menu folds away the button that opened it), to the
  // owner's fallback instead.
  const opener = useRef<HTMLElement | null>(null);
  const fallback = useRef(returnFocus);
  fallback.current = returnFocus;
  useEffect(() => {
    const at = document.activeElement;
    // Not the sheet's own heading: React's development double mount runs this twice.
    if (at instanceof HTMLElement && at !== document.body && !layerRef.current?.contains(at)) {
      opener.current = at;
    }
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      setTimeout(() => {
        // Only if focus went down with the sheet: not when it never closed (that
        // double mount), nor when something has taken focus since (the results opening).
        const now = document.activeElement;
        if (now && now !== document.body && now.isConnected) return;
        const visible = (el: HTMLElement | null | undefined) =>
          el?.isConnected && el.getClientRects().length > 0 ? el : null;
        (visible(opener.current) ?? visible(fallback.current?.()))?.focus({ preventScroll: true });
      }, 0);
    };
  }, []);

  const invite = roomInviteUrl(roomCode);
  const text = shareText(summary, youId, invite, true, festive);
  const publicText = shareText(summary, youId, SITE_URL, false, festive);
  /** The picture now, or the promise of it: a clipboard write must start inside the tap. */
  const picture = (): Blob | Promise<Blob> => file ?? pending.current ?? makeCard.current();

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // The top layer: no key reaches the results screen underneath (Escape
    // there would also close it).
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    trapTab(e);
  };

  const shareImage = () => {
    if (!file) return;
    if (!canShareFiles(file)) {
      say('This browser can’t share pictures. Save the image instead.');
      return;
    }
    void shareFile(file, text).then((r) => {
      if (r === 'shared') say('Shared');
      else if (r === 'failed') say('Couldn’t open sharing. Save the image instead.');
    });
  };
  const copyInvite = () => {
    void copyText(invite).then((ok) => say(ok ? 'Invite link copied' : `Copy this link: ${invite}`));
  };
  const save = () => {
    if (!file) return;
    downloadBlob(file, CARD_FILE);
    say('Saved');
  };
  const copyPicture = () => {
    void copyImage(picture()).then((ok) =>
      say(ok ? 'Image copied' : 'Couldn’t copy the image. Try Download.'),
    );
  };
  /** Slack, Discord and Teams take a pasted picture; there is no link that fills one in. */
  const pasteIn = (app: string) => {
    if (imageClip) {
      void copyImage(picture()).then((ok) =>
        say(ok ? `Image copied. Paste it in ${app}.` : `Couldn’t copy the image. Download it and add it in ${app}.`),
      );
    } else {
      void copyText(text).then((ok) =>
        say(ok ? `Message copied. Paste it in ${app}.` : 'Couldn’t copy the message.'),
      );
    }
  };
  /**
   * WhatsApp Web opens with the message, and the picture goes on the
   * clipboard to paste in. The tab opens once the copy is done: a page that
   * loses focus mid-write can have the write refused. The tap still counts
   * then (browsers allow a few seconds).
   */
  const toWhatsAppWeb = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!imageClip) return; // the link alone: the message, no picture
    e.preventDefault();
    const href = e.currentTarget.href;
    void copyImage(picture()).then((ok) => {
      const tab = window.open(href, '_blank');
      if (tab) tab.opener = null;
      if (!ok) say('Couldn’t copy the image. Download it and attach it.');
      else say(tab ? 'Image copied. Paste it into the chat' : 'Image copied. Tap WhatsApp again to open it.');
    });
  };

  const link = (
    href: string,
    label: string,
    note: string,
    onClick?: (e: ReactMouseEvent<HTMLAnchorElement>) => void,
  ) => (
    <a
      className="share-target"
      href={href}
      // Mail opens the mail app; everything else is a website.
      {...(href.startsWith('mailto:') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
      onClick={onClick}
    >
      {label}
      <small>{note}</small>
    </a>
  );

  return createPortal(
    <div className="share-layer" ref={layerRef}>
      <div className="share-scrim" onClick={onClose} aria-hidden="true" />
      <div
        className={`share-sheet ${mode}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="share-head">
          <h2 id={titleId} ref={headingRef} tabIndex={-1}>{title}</h2>
          <button type="button" className="small icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="share-preview">
          {url ? (
            <img src={url} alt={cardAlt(summary, youId, festive)} />
          ) : failed ? (
            <div className="share-failed">
              <p>The picture couldn’t be made.</p>
              <button type="button" className="small" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </div>
          ) : (
            <div className="shimmer" role="img" aria-label="Making the picture" />
          )}
        </div>

        {mode === 'native' && (
          <>
            <div className="share-main">
              <button type="button" className="accent big wide" onClick={shareImage} disabled={!file}>
                Share image
              </button>
              <p className="share-note">WhatsApp, Instagram, Slack, Discord and more</p>
            </div>
            <div className="share-utils">
              <button type="button" onClick={copyInvite}>Copy invite link</button>
              <button type="button" onClick={save} disabled={!file}>Save image</button>
            </div>
          </>
        )}

        {mode === 'links' && (
          <>
            <div className="share-grid">
              {link(targetHref('whatsapp', text, invite), 'WhatsApp', 'Sends the link')}
              {link(targetHref('telegram', text, invite), 'Telegram', 'Sends the link')}
              {link(targetHref('x', publicText, SITE_URL), 'X', 'Sends the link')}
              {link(targetHref('email', text, invite), 'Email', 'Sends the link')}
            </div>
            <div className="share-utils">
              <button type="button" onClick={save} disabled={!file}>Save image</button>
              <button type="button" onClick={copyInvite}>Copy invite link</button>
            </div>
          </>
        )}

        {mode === 'desktop' && (
          <>
            <div className="share-grid">
              {link(
                targetHref('whatsapp-web', text, invite),
                'WhatsApp',
                imageClip ? 'Copies the picture' : 'Sends the link',
                toWhatsAppWeb,
              )}
              {(['Slack', 'Discord', 'Teams'] as const).map((app) => (
                <button key={app} type="button" className="share-target" onClick={() => pasteIn(app)}>
                  {app}
                  <small>{imageClip ? 'Copies the picture' : 'Copies the message'}</small>
                </button>
              ))}
              {link(targetHref('x', publicText, SITE_URL), 'X', 'Sends the link')}
              {link(targetHref('telegram', text, invite), 'Telegram', 'Sends the link')}
              {link(targetHref('email', text, invite), 'Email', 'Sends the link')}
              {link(targetHref('linkedin', '', SITE_URL), 'LinkedIn', 'Post the link')}
            </div>
            <div className="share-utils">
              {imageClip && <button type="button" onClick={copyPicture}>Copy image</button>}
              <button type="button" onClick={save} disabled={!file}>Download</button>
              <button type="button" onClick={copyInvite}>Copy invite link</button>
            </div>
          </>
        )}

        <p className="share-status" role="status">{status}</p>
      </div>
    </div>,
    document.body,
  );
}
