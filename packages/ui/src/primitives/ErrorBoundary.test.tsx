import { Theme } from "@radix-ui/themes";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary, type ErrorBoundaryProps } from "./ErrorBoundary";

// External control so the child's throwing behaviour can change across the
// boundary's OWN internal re-render — children don't re-render from a parent
// while the fallback is showing, so a plain prop wouldn't take effect. This
// models a transient render loop (React #185) that trips once and then clears
// on the next mount, exactly the shape issue #2165 describes ("Try again
// recovers it"). Uses real timers so the actual setTimeout-driven recovery is
// exercised end to end.
const control = { shouldThrow: true };

function Flaky() {
  if (control.shouldThrow) throw new Error("Maximum update depth exceeded");
  return <div>recovered</div>;
}

function boundary(props: Partial<ErrorBoundaryProps>): ReactNode {
  return (
    <Theme>
      <ErrorBoundary {...props}>
        <Flaky />
      </ErrorBoundary>
    </Theme>
  );
}

beforeEach(() => {
  control.shouldThrow = true;
  // React logs caught errors to console.error; silence the expected noise.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorBoundary autoRecover", () => {
  it("replicates the defect: without autoRecover the fallback stays even after the transient condition clears (no resetKey change, no manual retry)", () => {
    const { rerender } = render(boundary({ resetKey: "task-a" }));
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // The transient loop condition clears, but navigating back to the SAME
    // task doesn't change resetKey — the boundary is stuck on the error.
    control.shouldThrow = false;
    rerender(boundary({ resetKey: "task-a" }));

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("recovered")).not.toBeInTheDocument();
  });

  it("auto-recovers a transient error without a manual retry, and reports it first", async () => {
    const onError = vi.fn();
    render(boundary({ autoRecover: true, onError }));

    // While the bounded recovery is pending it renders nothing — no flash of
    // the scary error UI for a one-frame transient — but it HAS reported it.
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
    expect(screen.queryByText("recovered")).not.toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);

    // The transient condition clears; the scheduled reset then re-renders the
    // healthy child on its own.
    control.shouldThrow = false;
    expect(await screen.findByText("recovered")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("is bounded: a persistent loop lands on the manual fallback instead of retrying forever", async () => {
    const onError = vi.fn();
    render(boundary({ autoRecover: true, onError }));

    // The child keeps throwing; after the bounded retries are spent the manual
    // fallback appears rather than an unbounded catch/retry storm.
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("recovered")).not.toBeInTheDocument();
    // 1 initial catch + at most MAX_AUTO_RECOVERIES (2) re-throws.
    expect(onError.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(onError.mock.calls.length).toBeLessThanOrEqual(3);

    // And it stays settled on the fallback — no further retries fire.
    const callsAfterSettle = onError.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(onError.mock.calls.length).toBe(callsAfterSettle);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("manual retry still recovers after auto-recovery is exhausted", async () => {
    const user = userEvent.setup();
    render(boundary({ autoRecover: true }));
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();

    control.shouldThrow = false;
    await user.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() =>
      expect(screen.getByText("recovered")).toBeInTheDocument(),
    );
  });
});
