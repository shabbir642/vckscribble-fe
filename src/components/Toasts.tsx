import { useEffect } from 'react';

interface Props {
  error: string | null;
  info: string | null;
  onDismiss: () => void;
}

/** Errors float above the game instead of shoving the layout down. */
export function Toasts({ error, info, onDismiss }: Props) {
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(onDismiss, 4500);
    return () => clearTimeout(t);
  }, [error, onDismiss]);

  if (!error && !info) return null;
  return (
    <div className="toasts">
      {info && (
        <div className="toast info" role="status">
          <span>{info}</span>
        </div>
      )}
      {error && (
        <div className="toast error" role="alert">
          <span>{error}</span>
          <button className="small" onClick={onDismiss}>
            OK
          </button>
        </div>
      )}
    </div>
  );
}
