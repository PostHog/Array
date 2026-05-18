import { Warning } from "@phosphor-icons/react";
import { Box, Button, Callout, Flex, Text } from "@radix-ui/themes";
import { captureException } from "@utils/analytics";
import { logger } from "@utils/logger";
import { Component, type ErrorInfo, type ReactNode } from "react";

const log = logger.scope("error-boundary");

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Optional name to identify which boundary caught the error */
  name?: string;
  /** When this value changes, the boundary clears its error state. */
  resetKey?: unknown;
  /**
   * If returns true for a caught error, the boundary renders nothing,
   * skips telemetry, and waits for `resetKey` to change before recovering.
   * Use to handle transient errors that the surrounding tree will resolve
   * (e.g. auth state about to flip to unauthenticated).
   */
  shouldSuppress?: (error: Error) => boolean;
}

interface State {
  error: Error | null;
  lastResetKey: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, lastResetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: Props,
    state: State,
  ): Partial<State> | null {
    if (props.resetKey === state.lastResetKey) return null;
    return { error: null, lastResetKey: props.resetKey };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (this.props.shouldSuppress?.(error)) {
      log.warn("Suppressed error in boundary", {
        name: this.props.name,
        error: error.message,
      });
      return;
    }

    log.error("Error caught by boundary", {
      name: this.props.name,
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    captureException(error, {
      $exception_component_stack: errorInfo.componentStack,
      boundary_name: this.props.name,
      source: "error-boundary",
    });
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.shouldSuppress?.(error)) return null;
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
