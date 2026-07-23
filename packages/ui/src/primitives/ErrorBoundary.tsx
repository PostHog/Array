import { Warning } from "@phosphor-icons/react";
import { Box, Button, Callout, Flex, Text } from "@radix-ui/themes";
import { Component, type ErrorInfo, type ReactNode } from "react";

// A transient render-loop error (React #185 "Maximum update depth exceeded" from
// a layout-timing setState cycle) trips once, then clears on the next mount —
// which is why clicking "Try again" has always recovered it. `autoRecover`
// replays that click for the user: after catching, it schedules a bounded number
// of resets so a transient error heals itself, while a persistent one still
// lands on the manual fallback instead of thrashing. The error is always
// reported via `onError` first, so root-cause visibility is unaffected.
const MAX_AUTO_RECOVERIES = 2;
const AUTO_RECOVER_BASE_DELAY_MS = 150;
// Once the subtree has rendered cleanly for this long, treat it as healthy and
// refill the recovery budget so a later, unrelated transient error gets its own
// retries rather than being starved by an earlier one.
const RECOVERY_STABLE_RESET_MS = 4000;

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  /** Optional name to identify which boundary caught the error */
  name?: string;
  /** When this value changes, the boundary clears its error state. */
  resetKey?: unknown;
  /**
   * Auto-clear a caught error a bounded number of times before showing the
   * manual retry fallback. Use for subtrees prone to transient render-loop
   * errors that clear on remount (e.g. the chat SessionView, whose #185 loop
   * has always been recoverable via "Try again"). While an auto-recovery is
   * pending the boundary renders nothing rather than flashing the error UI. The
   * error is still reported via `onError` on every catch, so observability is
   * unaffected. Off by default.
   */
  autoRecover?: boolean;
  /**
   * If returns true for a caught error, the boundary renders nothing,
   * skips the fallback UI, and waits for `resetKey` to change before
   * recovering. Use to handle transient errors that the surrounding tree
   * will resolve (e.g. auth state about to flip to unauthenticated).
   */
  shouldSuppress?: (error: Error) => boolean;
  /**
   * Called when an error is caught, before rendering. The host wires this to
   * its telemetry/logging; the primitive itself stays host-agnostic.
   * `suppressed` is true when `shouldSuppress` matched the error.
   */
  onError?: (
    error: Error,
    info: { componentStack?: string | null; suppressed: boolean },
  ) => void;
}

interface State {
  error: Error | null;
  lastResetKey: unknown;
  /** How many times autoRecover has cleared an error since the last healthy
   * stretch / resetKey change. Caps auto-recovery so a persistent loop can't
   * thrash the boundary. */
  recoveryAttempts: number;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = {
    error: null,
    lastResetKey: this.props.resetKey,
    recoveryAttempts: 0,
  };

  private recoverTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: State,
  ): Partial<State> | null {
    if (props.resetKey === state.lastResetKey) return null;
    // A genuine new context (e.g. a different task): clear the error and refill
    // the auto-recovery budget.
    return { error: null, lastResetKey: props.resetKey, recoveryAttempts: 0 };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const suppressed = this.props.shouldSuppress?.(error) ?? false;
    this.props.onError?.(error, {
      componentStack: errorInfo.componentStack,
      suppressed,
    });
    if (suppressed) return;
    // A fresh error means the subtree isn't healthy yet — cancel any pending
    // budget refill and, if enabled, schedule the next bounded auto-recovery.
    this.clearStableTimer();
    if (this.props.autoRecover) this.scheduleAutoRecover();
  }

  componentDidUpdate(_prevProps: ErrorBoundaryProps, prevState: State) {
    // The error just cleared (auto-recovery or manual retry). If it doesn't
    // recur within the stability window, refill the recovery budget so a later
    // unrelated transient error isn't starved of retries.
    if (this.props.autoRecover && prevState.error && !this.state.error) {
      this.clearStableTimer();
      this.stableTimer = setTimeout(() => {
        this.stableTimer = null;
        if (this.state.recoveryAttempts !== 0) {
          this.setState({ recoveryAttempts: 0 });
        }
      }, RECOVERY_STABLE_RESET_MS);
    }
  }

  componentWillUnmount() {
    this.clearRecoverTimer();
    this.clearStableTimer();
  }

  private scheduleAutoRecover(): void {
    if (this.recoverTimer !== null) return;
    if (this.state.recoveryAttempts >= MAX_AUTO_RECOVERIES) return;
    // Back off a little per attempt so a loop that needs a beat to settle gets
    // progressively more time before we give up to the manual fallback.
    const delay =
      AUTO_RECOVER_BASE_DELAY_MS * (this.state.recoveryAttempts + 1);
    this.recoverTimer = setTimeout(() => {
      this.recoverTimer = null;
      this.setState((s) =>
        s.error
          ? { error: null, recoveryAttempts: s.recoveryAttempts + 1 }
          : null,
      );
    }, delay);
  }

  private clearRecoverTimer(): void {
    if (this.recoverTimer !== null) {
      clearTimeout(this.recoverTimer);
      this.recoverTimer = null;
    }
  }

  private clearStableTimer(): void {
    if (this.stableTimer !== null) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  handleRetry = () => {
    this.clearRecoverTimer();
    this.setState({ error: null, recoveryAttempts: 0 });
  };

  render() {
    const { error, recoveryAttempts } = this.state;
    if (!error) return this.props.children;
    if (this.props.shouldSuppress?.(error)) return null;
    // While a bounded auto-recovery is still pending, render nothing rather than
    // flashing the error UI for what is (usually) a one-frame transient loop.
    // componentDidCatch has scheduled the reset that will re-render the children.
    if (this.props.autoRecover && recoveryAttempts < MAX_AUTO_RECOVERIES) {
      return null;
    }
    if (this.props.fallback) return this.props.fallback;

    return (
      <Box p="4">
        <Callout.Root color="red" size="2">
          <Callout.Icon>
            <Warning weight="fill" />
          </Callout.Icon>
          <Callout.Text>
            <Flex direction="column" gap="2">
              <Text className="font-medium">Something went wrong</Text>
              <Text className="text-[13px] text-gray-11">
                {error.message || "An unexpected error occurred"}
              </Text>
              <Flex gap="2" mt="2">
                <Button size="1" variant="soft" onClick={this.handleRetry}>
                  Try again
                </Button>
              </Flex>
            </Flex>
          </Callout.Text>
        </Callout.Root>
      </Box>
    );
  }
}
