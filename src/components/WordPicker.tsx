import { useState } from 'react';
import type { WordChoice } from '../generated/contract';

interface Props {
  choices: WordChoice[];
  allowCustom: boolean;
  busy: boolean;
  secondsLeft: number;
  onChoose: (id: number) => void;
  onCustom: (text: string) => void;
}

const DIFFICULTY = ['', 'easy to draw', 'medium', 'tough'];

/** Requirement 1: three on offer, or write your own. */
export function WordPicker({
  choices, allowCustom, busy, secondsLeft, onChoose, onCustom,
}: Props) {
  const [own, setOwn] = useState('');
  const [writing, setWriting] = useState(false);

  return (
    <div className="card picker">
      <div className="row-between">
        <h3>Pick a word to draw</h3>
        <span className="timer">{secondsLeft}s</span>
      </div>

      <div className="choices">
        {choices.map((c) => (
          <button key={c.id} className="choice" disabled={busy} onClick={() => onChoose(c.id)}>
            <strong>{c.text}</strong>
            <span className="muted">{DIFFICULTY[c.drawability]}</span>
          </button>
        ))}
      </div>

      {allowCustom && !writing && (
        <button className="link" onClick={() => setWriting(true)}>
          None of these — write my own
        </button>
      )}

      {allowCustom && writing && (
        <form
          className="actions"
          onSubmit={(e) => {
            e.preventDefault();
            if (own.trim().length >= 3) onCustom(own.trim());
          }}
        >
          <input
            value={own}
            onChange={(e) => setOwn(e.target.value)}
            placeholder="your own slang…"
            maxLength={40}
            autoFocus
          />
          <button className="primary" type="submit" disabled={busy || own.trim().length < 3}>
            Draw this
          </button>
          <button type="button" onClick={() => setWriting(false)}>Cancel</button>
        </form>
      )}
      {allowCustom && writing && (
        <p className="muted small">
          Everyone will see it immediately, so keep it guessable. Good ones get
          added to the dictionary.
        </p>
      )}
      {!allowCustom && <p className="muted small">Custom words are used up or disabled.</p>}
    </div>
  );
}
