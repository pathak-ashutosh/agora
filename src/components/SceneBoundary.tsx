import { Component, type ReactNode } from 'react';
import { createLogger } from '@/lib/log';

const log = createLogger('scene');

/** A scene that throws must not blank the whole app. */
export class SceneBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    log.error(
      `scene "${this.props.resetKey}" crashed: ${error.message}`,
      info.componentStack ?? undefined
    );
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-[var(--color-text-muted)]">
          <div className="font-display text-lg text-[var(--color-text)]">
            This view hit an error
          </div>
          <div className="font-mono text-xs text-[var(--color-text-dim)] max-w-md text-center">
            {this.state.error.message}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-2 px-3 py-1.5 rounded-full border border-[var(--color-border-strong)] text-xs hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
          >
            try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
