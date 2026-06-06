import { Theme } from "@radix-ui/themes";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const selectDirectoryQuery = vi.fn();
const addFolder = vi.fn().mockResolvedValue(undefined);

vi.mock("@renderer/trpc", () => ({
  trpcClient: {
    os: { selectDirectory: { query: () => selectDirectoryQuery() } },
  },
}));

vi.mock("@features/folders/hooks/useFolders", () => ({
  useFolders: () => ({
    getRecentFolders: () => [],
    getFolderDisplayName: () => null,
    addFolder,
    updateLastAccessed: vi.fn(),
    getFolderByPath: vi.fn(),
  }),
}));

vi.mock("@utils/logger", () => ({
  logger: { scope: () => ({ error: vi.fn() }) },
}));

import { FolderPicker } from "./FolderPicker";

/** A promise we resolve by hand, to hold the picker open mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function renderPicker() {
  const onChange = vi.fn();
  render(
    <Theme>
      <FolderPicker variant="field" value="" onChange={onChange} />
    </Theme>,
  );
  return { onChange, trigger: screen.getByRole("button") };
}

describe("FolderPicker", () => {
  afterEach(() => vi.clearAllMocks());

  it("shows feedback synchronously while the dialog is open, then commits the path", async () => {
    // The synchronous "Opening..." state both reassures the user and gives
    // PostHog a DOM mutation, so the open native dialog stops being logged as a
    // dead click.
    const user = userEvent.setup();
    const pending = deferred<string | null>();
    selectDirectoryQuery.mockReturnValue(pending.promise);
    const { onChange, trigger } = renderPicker();

    await user.click(trigger);

    expect(trigger).toHaveTextContent("Opening...");
    expect(trigger).toBeDisabled();

    pending.resolve("/Users/me/code/posthog");

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("/Users/me/code/posthog"),
    );
    expect(addFolder).toHaveBeenCalledTimes(1);
    expect(trigger).not.toBeDisabled();
  });

  it("ignores re-clicks while a dialog is already open", async () => {
    const user = userEvent.setup();
    const pending = deferred<string | null>();
    selectDirectoryQuery.mockReturnValue(pending.promise);
    const { trigger } = renderPicker();

    await user.click(trigger);
    await user.click(trigger);

    expect(selectDirectoryQuery).toHaveBeenCalledTimes(1);

    pending.resolve(null);
    await waitFor(() => expect(trigger).not.toBeDisabled());
  });
});
