"use client";

import * as React from "react";

interface State { hasError: boolean; message?: string }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode; label?: string }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(err: unknown): State {
    return { hasError: true, message: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(error: unknown) {
    console.error("ErrorBoundary caught", this.props.label, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-md border border-loss/40 bg-loss/10 p-3 text-xs">
          <div className="font-medium text-loss">{this.props.label ?? "Component"} failed</div>
          {this.state.message && <div className="mt-1 text-muted-foreground">{this.state.message}</div>}
        </div>
      );
    }
    return this.props.children;
  }
}
