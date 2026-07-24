import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfigFile: vi.fn(),
  updateConfigFile: vi.fn(),
}));

vi.mock("@posthog/di/react", () => ({
  useService: () => mocks,
}));

vi.mock("@posthog/ui/features/skills/SkillCodeEditor", () => ({
  SkillCodeEditor: ({
    initialContent,
    onDocChanged,
  }: {
    initialContent: string;
    onDocChanged: (content: string) => void;
  }) => (
    <textarea
      aria-label="MCP config"
      defaultValue={initialContent}
      onChange={(event) => onDocChanged(event.target.value)}
    />
  ),
}));

vi.mock("@posthog/ui/primitives/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { LocalMcpConfigView } from "./LocalMcpConfigView";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("LocalMcpConfigView", () => {
  beforeEach(() => {
    mocks.getConfigFile.mockReset();
    mocks.updateConfigFile.mockReset();
    mocks.getConfigFile.mockResolvedValue({
      path: "/home/user/.posthog-code/mcp.json",
      content: '{"mcpServers":{}}',
    });
    mocks.updateConfigFile.mockImplementation(async (content: string) => ({
      path: "/home/user/.posthog-code/mcp.json",
      content,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes an edit when navigating away before the debounce", async () => {
    const view = render(<LocalMcpConfigView openKey={1} />, { wrapper });
    const editor = await screen.findByLabelText("MCP config");
    vi.useFakeTimers();

    fireEvent.change(editor, { target: { value: "changed" } });
    act(() => vi.advanceTimersByTime(499));
    expect(mocks.updateConfigFile).not.toHaveBeenCalled();

    view.unmount();
    expect(mocks.updateConfigFile).toHaveBeenCalledWith("changed");
  });

  it("autosaves invalid JSON and announces the invalid state", async () => {
    render(<LocalMcpConfigView openKey={1} />, { wrapper });
    const editor = await screen.findByLabelText("MCP config");

    fireEvent.change(editor, { target: { value: "{ invalid" } });

    await waitFor(() =>
      expect(mocks.updateConfigFile).toHaveBeenCalledWith("{ invalid"),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Saved, invalid JSON",
    );
  });

  it("shows a read error without exposing an empty editable config", async () => {
    mocks.getConfigFile.mockRejectedValue(new Error("read failed"));

    render(<LocalMcpConfigView openKey={1} />, { wrapper });

    expect(await screen.findByText("read failed")).toBeVisible();
    expect(screen.queryByLabelText("MCP config")).not.toBeInTheDocument();
  });
});
