import { memo, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../generated/contract';

interface Props {
  messages: ChatMessage[];
  canGuess: boolean;
  placeholder: string;
  closeHint: string | null;
  onGuess: (text: string) => void;
  title?: string;
}

/** Memoized: the clock ticks every second and must not re-render 200 messages. */
export const Chat = memo(function Chat({
  messages, canGuess, placeholder, closeHint, onGuess, title = 'Guesses',
}: Props) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  // Following the newest message, unless the reader scrolled up to read back.
  const follow = useRef(true);

  // Stick to the bottom as messages arrive — scrolling the list itself, not
  // the page, so a new guess never yanks the canvas out of view.
  useEffect(() => {
    const el = listRef.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // The list changes height too (a phone keyboard opening, a close-guess hint
  // appearing): stay on the newest message through that as well.
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (follow.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="card chat">
      <h3>{title}</h3>
      <div
        className="messages"
        ref={listRef}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {messages.length === 0 && <div className="msg muted">No messages yet.</div>}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.channel} tone-${m.tone ?? 'neutral'}`}>
            {m.playerName && <span className="who">{m.playerName}:</span>}
            <span>{m.text}</span>
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          onGuess(t);
          setText('');
          follow.current = true; // your own message: always show it
        }}
      >
        {closeHint && <div className="close-hint" role="status">{closeHint}</div>}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          disabled={!canGuess}
          maxLength={120}
          aria-label={placeholder}
        />
      </form>
    </div>
  );
});
