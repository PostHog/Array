import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@renderer/features/code-review/stores/reviewNavigationStore", () => ({
  useReviewNavigationStore: vi.fn(),
}));
vi.mock("@features/code-editor/stores/diffViewerStore", () => ({
  useDiffViewerStore: vi.fn(),
}));
vi.mock("@features/task-detail/components/ChangesPanel", () => ({
  ChangesPanel: () => null,
}));
vi.mock("@features/git-interaction/utils/diffStats", () => ({
  computeDiffStats: () => ({ linesAdded: 0, linesRemoved: 0 }),
}));
vi.mock("@stores/themeStore", () => ({
  useThemeStore: vi.fn(() => ({ isDarkMode: false })),
}));
vi.mock("@pierre/diffs/react", () => ({
  WorkerPoolContextProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("@pierre/diffs/worker/worker.js?worker&url", () => ({ default: "" }));
vi.mock("@components/ui/FileIcon", () => ({
  FileIcon: () => <span data-testid="file-icon" />,
}));
vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {},
  useTRPC: vi.fn(),
}));
vi.mock("@features/sessions/service/service", () => ({
  getSessionService: vi.fn(),
}));

import { DeferredDiffPlaceholder, DiffFileHeader } from "./ReviewShell";

type FileDiffMetadata = import("@pierre/diffs/react").FileDiffMetadata;

function makeFileDiff(name: string): FileDiffMetadata {
  return {
    name,
    prevName: null,
    hunks: [{ additionLines: 3, deletionLines: 1 }],
  } as unknown as FileDiffMetadata;
}

function findSpan(
  container: HTMLElement,
  match: (s: HTMLSpanElement) => boolean,
): HTMLSpanElement {
  const spans = Array.from(container.querySelectorAll<HTMLSpanElement>("span"));
  const found = spans.find(match);
  if (!found) throw new Error("span not found");
  return found;
}

function renderHeader(path: string) {
  const diff = render(
    <DiffFileHeader
      fileDiff={makeFileDiff(path)}
      collapsed={false}
      onToggle={() => {}}
    />,
  );
  const deferred = render(
    <DeferredDiffPlaceholder
      filePath={path}
      linesAdded={10}
      linesRemoved={2}
      reason="generated"
      collapsed={false}
      onToggle={() => {}}
    />,
  );
  return { diff, deferred };
}

describe.each([
  ["DiffFileHeader", "diff" as const],
  ["DeferredDiffPlaceholder", "deferred" as const],
])("%s", (_name, which) => {
  it("renders the directory path and filename", () => {
    const rendered = renderHeader(
      "src/renderer/features/code-review/components/ReviewShell.tsx",
    )[which];

    const text = rendered.container.querySelector("button")?.textContent ?? "";
    expect(text).toContain("src/renderer/features/code-review/components/");
    expect(text).toContain("ReviewShell.tsx");
  });

  it("truncates the directory path and keeps the filename intact", () => {
    const rendered = renderHeader(
      "src/a/very/deeply/nested/structure/ReviewShell.tsx",
    )[which];

    // Inline styles were migrated to Tailwind utility classes; check classes
    // instead. The dir span gets the muted color + truncation utilities, the
    // file span gets bold weight + a non-shrinking flex behavior.
    const dirSpan = findSpan(rendered.container, (s) =>
      s.classList.contains("text-(--gray-9)"),
    );
    const fileSpan = findSpan(rendered.container, (s) =>
      s.classList.contains("font-semibold"),
    );

    expect(dirSpan.classList.contains("overflow-hidden")).toBe(true);
    expect(dirSpan.classList.contains("text-ellipsis")).toBe(true);
    expect(dirSpan.classList.contains("whitespace-nowrap")).toBe(true);

    expect(fileSpan.classList.contains("whitespace-nowrap")).toBe(true);
    expect(fileSpan.classList.contains("shrink-0")).toBe(true);

    expect(dirSpan.parentElement).toBe(fileSpan.parentElement);
    expect(dirSpan.parentElement?.classList.contains("flex")).toBe(true);
  });
});
