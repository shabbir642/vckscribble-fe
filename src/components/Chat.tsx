import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../generated/contract';

interface Props {
  messages: ChatMessage[];
  canGuess: boolean;
  placeholder: string;
  closeHint: string | null;
  onGuess: (text: string) => void;
}

export function Chat({ messages, canGuess, placeholder, closeHint, onGuess }: Props) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);

  return (
    <div className="card chat">
      <div className="messages">
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.channel} tone-${m.tone ?? 'neutral'}`}>
            {m.playerName && <span className="who">{m.playerName}</span>}
            <span>{m.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {closeHint && <div className="close-hint">{closeHint}</div>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          onGuess(t);
          setText('');
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          disabled={!canGuess}
          maxLength={120}
        />
      </form>
    </div>
  );
}
