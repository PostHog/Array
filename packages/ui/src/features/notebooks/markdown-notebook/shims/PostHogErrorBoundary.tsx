/**
 * Minimal stand-in for `PostHogErrorBoundary` from `@posthog/react`: a plain
 * React error boundary that renders the `fallback` prop. `additionalProperties`
 * is accepted for API compatibility but not reported anywhere.
 */
import { Component, type ReactNode } from "react";

export interface PostHogErrorBoundaryProps {
  children?: ReactNode;
  fallback?: ReactNode | ((props: { error: unknown }) => ReactNode);
  additionalProperties?: Record<string, unknown>;
}

interface PostHogErrorBoundaryState {
  hasError: boolean;
  error: unknown;
}

export class PostHogErrorBoundary extends Component<
  PostHogErrorBoundaryProps,
  PostHogErrorBoundaryState
> {
  state: PostHogErrorBoundaryState = { hasError: false, error: undefined };

  static getDerivedStateFromError(error: unknown): PostHogErrorBoundaryState {
    return { hasError: true, error };
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const { fallback } = this.props;
      return typeof fallback === "function"
        ? fallback({ error: this.state.error })
        : (fallback ?? null);
    }
    return this.props.children;
  }
}
