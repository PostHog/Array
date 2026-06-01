import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeneratingIndicator } from "./GeneratingIndicator";

describe("GeneratingIndicator slow-connection hint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("surfaces a slow-connection hint after a long quiet stretch", () => {
    render(
      <GeneratingIndicator
        startedAt={Date.now()}
        activitySignal={1}
        slowHintMs={8000}
      />,
    );

    expect(screen.queryByText(/slow connection/i)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(9000);
    });

    expect(screen.getByText(/slow connection/i)).toBeInTheDocument();
  });

  it("clears the hint when stream activity resumes", () => {
    const { rerender } = render(
      <GeneratingIndicator
        startedAt={Date.now()}
        activitySignal={1}
        slowHintMs={8000}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(screen.getByText(/slow connection/i)).toBeInTheDocument();

    // A new event arrives — the agent is making progress again.
    rerender(
      <GeneratingIndicator
        startedAt={Date.now()}
        activitySignal={2}
        slowHintMs={8000}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.queryByText(/slow connection/i)).toBeNull();
  });

  it("never shows the hint when no activity signal is provided", () => {
    render(<GeneratingIndicator startedAt={Date.now()} />);

    act(() => {
      vi.advanceTimersByTime(60000);
    });

    expect(screen.queryByText(/slow connection/i)).toBeNull();
  });

  it("shows a reconnecting state instead of the thinking activity when offline", () => {
    render(<GeneratingIndicator startedAt={Date.now()} isOnline={false} />);

    expect(screen.getByText(/waiting to reconnect/i)).toBeInTheDocument();
  });

  it("shows the normal thinking activity when online", () => {
    render(<GeneratingIndicator startedAt={Date.now()} isOnline={true} />);

    expect(screen.queryByText(/waiting to reconnect/i)).toBeNull();
  });

  it("counts the reconnect timer from the drop, not the turn start", () => {
    const start = Date.now();
    const { rerender } = render(
      <GeneratingIndicator startedAt={start} isOnline={true} />,
    );

    // Turn runs online for a minute, then the connection drops.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    rerender(<GeneratingIndicator startedAt={start} isOnline={false} />);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // The reconnect timer reflects ~0.5s offline, not the 60s total turn time.
    expect(screen.getByText(/0\.\ds\)/)).toBeInTheDocument();
    expect(screen.queryByText(/6\d\.\ds\)/)).toBeNull();
  });
});
