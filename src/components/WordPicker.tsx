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

const DIFFICULTY = ['', 'Easy to draw', 'Medium', 'Tough'];

/** Requirement 1: three on offer, or write your own. Shown over the canvas. */
export function WordPicker({
  choices, allowCustom, busy, secondsLeft, onChoose, onCustom,
}: Props) {
  const [own, setOwn] = useState('');
  const [writing, setWriting] = useState(false);

  return (
    <>
      <h2>Choose a word to draw</h2>
      <p className="muted">
        {secondsLeft > 0 ? `${secondsLeft} seconds, or one gets picked for you` : 'Picking one for you…'}
      </p>

      <div className="choices">
        {choices.map((c) => (
          <button key={c.id} className="choice" disabled={busy} onClick={() => onChoose(c.id)}>
            <span>{c.text}</span>
            <span className="level">{DIFFICULTY[c.drawability]}</span>
          </button>
        ))}
      </div>

      {allowCustom && !writing && (
        <button className="link" onClick={() => setWriting(true)}>
          None of these? Write your own
        </button>
      )}

      {allowCustom && writing && (
        <>
          <form
            className="custom-word"
            onSubmit={(e) => {
              e.preventDefault();
              if (own.trim().length >= 3) onCustom(own.trim());
            }}
          >
            <input
              value={own}
              onChange={(e) => setOwn(e.target.value)}
              placeholder="Your own corporate slang"
              maxLength={40}
              autoFocus
            />
            <button className="primary" type="submit" disabled={busy || own.trim().length < 3}>
              Draw it
            </button>
          </form>
          <p className="muted small">
            Keep it guessable. Good ones get added to the dictionary.{' '}
            <button className="link small" onClick={() => setWriting(false)}>Back to the list</button>
          </p>
        </>
      )}
    </>
  );
}
