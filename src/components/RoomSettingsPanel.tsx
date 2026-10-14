import { useEffect, useState } from 'react';
import {
  DRAW_TIMES,
  MIN_CUSTOM_WORDS,
  WORD_PACKS,
  type Result,
  type RoomSettings,
  type WordDifficulty,
  type WordPackId,
} from '../generated/contract';

type Patch = Partial<Omit<RoomSettings, 'customWordCount'>>;

interface Props {
  settings: RoomSettings;
  isHost: boolean;
  busy: boolean;
  hostName: string | null;
  /** The host's custom list; null for everyone else. */
  hostWords: string[] | null;
  onSettings: (patch: Patch) => void;
  onCustomWords: (text: string) => Promise<Result<{ accepted: number; rejected: string[] }>>;
}

const DIFFICULTIES: { id: WordDifficulty; label: string; hint: string }[] = [
  { id: 'easy', label: 'Easy', hint: 'Words that draw themselves' },
  { id: 'mixed', label: 'Mixed', hint: 'Mostly easy, some trickier' },
  { id: 'hard', label: 'Hard', hint: 'Anything goes, even “synergy”' },
];

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * Room settings, skribbl-style: dropdowns, a difficulty switch, word packs
 * and the host's own words. Everyone sees them; only the host can change them.
 */
export function RoomSettingsPanel({
  settings: s, isHost, busy, hostName, hostWords, onSettings, onCustomWords,
}: Props) {
  const locked = !isHost || busy;
  const [draft, setDraft] = useState(() => (hostWords ?? []).join(', '));
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Follow the server's list unless the host is mid-edit.
  useEffect(() => {
    if (!dirty) setDraft((hostWords ?? []).join(', '));
  }, [hostWords, dirty]);

  const togglePack = (id: WordPackId) => {
    const on = s.wordPacks.includes(id);
    if (on && s.wordPacks.length === 1 && !s.customWordsOnly) return; // keep at least one
    onSettings({ wordPacks: on ? s.wordPacks.filter((p) => p !== id) : [...s.wordPacks, id] });
  };

  const saveWords = async () => {
    const r = await onCustomWords(draft);
    if (!r.ok) return;
    setDirty(false);
    setResult(
      `${r.accepted} word${r.accepted === 1 ? '' : 's'} saved.` +
        (r.rejected.length ? ` Skipped: ${r.rejected.slice(0, 6).join(', ')}${r.rejected.length > 6 ? '…' : ''}` : ''),
    );
  };

  const select = (
    label: string,
    value: number,
    options: number[],
    format: (n: number) => string,
    key: keyof Patch,
  ) => (
    <label className="field inline">
      <span>{label}</span>
      <select
        value={value}
        disabled={locked}
        onChange={(e) => onSettings({ [key]: Number(e.target.value) } as Patch)}
      >
        {options.map((n) => (
          <option key={n} value={n}>{format(n)}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="card settings">
      <h3>Game settings</h3>
      {!isHost && (
        <p className="muted small" style={{ marginBottom: 12 }}>
          {hostName ? `${hostName} picks the settings.` : 'The host picks the settings.'}
        </p>
      )}

      {select('Rounds', s.rounds, range(1, 10), String, 'rounds')}
      {select('Draw time', s.drawSeconds, DRAW_TIMES, (n) => `${n} seconds`, 'drawSeconds')}
      {select('Words to choose from', s.wordChoices, range(1, 5), String, 'wordChoices')}
      {select('Hints', s.hints, range(0, 5), (n) => (n === 0 ? 'No hints' : `Up to ${n} letter${n > 1 ? 's' : ''}`), 'hints')}
      {select('Max players', s.maxPlayers, range(2, 16), String, 'maxPlayers')}

      <div className="field">
        <span>Word difficulty</span>
        <div className="segmented" role="radiogroup" aria-label="Word difficulty">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={s.difficulty === d.id}
              className={s.difficulty === d.id ? 'on' : ''}
              disabled={locked}
              title={d.hint}
              onClick={() => onSettings({ difficulty: d.id })}
            >
              {d.label}
            </button>
          ))}
        </div>
        <span className="muted small">{DIFFICULTIES.find((d) => d.id === s.difficulty)?.hint}</span>
      </div>

      <div className={`field ${s.customWordsOnly ? 'dimmed' : ''}`}>
        <span>Word packs</span>
        <div className="chips">
          {WORD_PACKS.map((p) => {
            const on = s.wordPacks.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`chip ${on ? 'on' : ''}`}
                aria-pressed={on}
                disabled={locked}
                onClick={() => togglePack(p.id)}
              >
                <span aria-hidden="true">{p.emoji}</span> {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="field inline">
        <span>Drawers can write their own word</span>
        <input
          type="checkbox"
          disabled={locked}
          checked={s.allowCustomWords}
          onChange={(e) => onSettings({ allowCustomWords: e.target.checked })}
        />
      </label>

      <div className="field custom-words">
        <span>Your own words</span>
        {isHost ? (
          <>
            <textarea
              value={draft}
              rows={4}
              disabled={busy}
              placeholder="Comma-separated, like: coffee run, stand-up, the office dog"
              onChange={(e) => {
                setDraft(e.target.value);
                setDirty(true);
                setResult(null);
              }}
            />
            <div className="row-between">
              <span className="muted small">
                {result ?? `${s.customWordCount} saved. Only you can see this list.`}
              </span>
              <button className="small" disabled={busy || !dirty} onClick={() => void saveWords()}>
                Save words
              </button>
            </div>
            <label className="field inline" style={{ marginTop: 8, marginBottom: 0 }}>
              <span>Use only my words (at least {MIN_CUSTOM_WORDS})</span>
              <input
                type="checkbox"
                disabled={busy}
                checked={s.customWordsOnly}
                onChange={(e) => onSettings({ customWordsOnly: e.target.checked })}
              />
            </label>
          </>
        ) : (
          <span className="muted small">
            {s.customWordCount
              ? `${s.customWordCount} custom words added${s.customWordsOnly ? ', and only those will be used' : ''}.`
              : 'No custom words.'}
          </span>
        )}
      </div>
    </div>
  );
}
