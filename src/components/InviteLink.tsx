import { useState } from 'react';
import { roomInviteUrl } from '../lib/session';

/**
 * The one place an invite link is built and copied, so the lobby and the
 * in-game header can never disagree about its format.
 *
 * navigator.clipboard only exists in a secure context, so over plain http on a
 * LAN address it is undefined. Fall back to a hidden textarea, and if even that
 * fails, reveal the link so it can be copied by hand.
 */
export function InviteLink({ roomCode, compact = false }: { roomCode: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const url = roomInviteUrl(roomCode);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (!ok) throw new Error('execCommand refused');
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setShowLink(true);
    }
  };

  return (
    <div className={`invite-link ${compact && !showLink ? 'compact' : ''}`}>
      <input
        className="invite"
        readOnly
        value={url}
        onFocus={(e) => e.target.select()}
        aria-label="Invite link"
      />
      <button className={`accent ${compact ? 'small' : ''}`} onClick={copy} title={url}>
        {copied ? 'Copied!' : compact ? '🔗 Invite' : 'Copy link'}
      </button>
    </div>
  );
}
