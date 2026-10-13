import { Component, type ErrorInfo, type ReactNode } from 'react';
import { report } from '../lib/report';

interface Props { children: ReactNode }
interface State { failed: boolean; message: string }

/**
 * A React render error otherwise unmounts the whole tree and leaves a white
 * page — the player sees nothing and the server hears nothing. Catch it, say so,
 * and report it.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, message: '' };

  static getDerivedStateFromError(e: unknown): State {
    return { failed: true, message: e instanceof Error ? e.message : String(e) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    report({
      source: 'render',
      message: error.message,
      detail: `${error.stack ?? ''}\n--- component stack ---${info.componentStack ?? ''}`.slice(0, 2000),
    });
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="wrap">
        <div className="card">
          <h1>That broke.</h1>
          <p className="sub">
            The problem has been reported. Reloading usually gets you back into the
            room — your seat is held for a minute.
          </p>
          <p className="mono muted small">{this.state.message}</p>
          <button className="primary" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
