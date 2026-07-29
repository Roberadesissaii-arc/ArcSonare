import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  error: Error | null;
}

/**
 * Keeps the shell usable when a page subtree crashes (instead of a blank window).
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ArcSonare] UI crash:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="app-error-boundary" role="alert">
        <h2>{this.props.fallbackTitle ?? "Something went wrong"}</h2>
        <p>
          ArcSonare hit an unexpected error on this screen. You can retry or keep
          using the rest of the app.
        </p>
        <pre>{this.state.error.message}</pre>
        <button
          type="button"
          className="btn-pill"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    );
  }
}
