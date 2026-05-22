import { Theme } from "@radix-ui/themes";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@features/git-interaction/state/gitInteractionStore", () => ({
  useGitInteractionStore: () => ({ actions: { openBranch: vi.fn() } }),
}));

vi.mock("@features/git-interaction/utils/getSuggestedBranchName", () => ({
  getSuggestedBranchName: vi.fn(() => null),
}));

vi.mock("@features/git-interaction/utils/gitCacheKeys", () => ({
  invalidateGitBranchQueries: vi.fn(),
}));

vi.mock("@renderer/trpc", () => ({
  useTRPC: () => ({
    git: {
      getAllBranches: { queryOptions: () => ({ queryKey: ["mock"] }) },
      checkoutBranch: { mutationOptions: () => ({}) },
    },
  }),
}));

vi.mock("@renderer/utils/toast", () => ({
  toast: { error: vi.fn() },
}));

const mutateMock = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isLoading: false }),
  useMutation: () => ({ mutate: mutateMock }),
}));

import { BranchSelector } from "./BranchSelector";

function renderInTheme(children: React.ReactElement) {
  return render(<Theme>{children}</Theme>);
}

describe("BranchSelector cloud mode", () => {
  it("keeps the trigger enabled while the initial cloud load is in flight", () => {
    renderInTheme(
      <BranchSelector
        repoPath="owner/repo"
        currentBranch={null}
        workspaceMode="cloud"
        cloudBranches={[]}
        cloudBranchesLoading={true}
        cloudSearchQuery=""
        onBranchSelect={vi.fn()}
        onCloudSearchChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Branch" })).toBeEnabled();
  });

  it("surfaces the 'Use input as branch name' action when the typed value is new", async () => {
    const user = userEvent.setup();
    renderInTheme(
      <BranchSelector
        repoPath="owner/repo"
        currentBranch={null}
        workspaceMode="cloud"
        cloudBranches={["main", "feature-a"]}
        cloudBranchesLoading={false}
        cloudSearchQuery="brand-new-branch"
        onBranchSelect={vi.fn()}
        onCloudSearchChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Branch" }));

    expect(
      await screen.findByText('Use "brand-new-branch" as branch name'),
    ).toBeInTheDocument();
  });

  it("hides the typed-name action when the input exactly matches an existing branch", async () => {
    const user = userEvent.setup();
    renderInTheme(
      <BranchSelector
        repoPath="owner/repo"
        currentBranch={null}
        workspaceMode="cloud"
        cloudBranches={["main", "feature-a"]}
        cloudBranchesLoading={false}
        cloudSearchQuery="main"
        onBranchSelect={vi.fn()}
        onCloudSearchChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Branch" }));

    expect(
      screen.queryByText(/Use "main" as branch name/),
    ).not.toBeInTheDocument();
  });

  it("commits the typed value via onBranchSelect when the sentinel action is selected", async () => {
    const user = userEvent.setup();
    const onBranchSelect = vi.fn();
    renderInTheme(
      <BranchSelector
        repoPath="owner/repo"
        currentBranch={null}
        workspaceMode="cloud"
        cloudBranches={[]}
        cloudBranchesLoading={true}
        cloudSearchQuery="brand-new-branch"
        onBranchSelect={onBranchSelect}
        onCloudSearchChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Branch" }));
    await user.click(
      await screen.findByText('Use "brand-new-branch" as branch name'),
    );

    expect(onBranchSelect).toHaveBeenCalledWith("brand-new-branch");
  });

  it("invokes onCloudBranchCommit when the typed value is committed (so the parent can reset the search)", async () => {
    const user = userEvent.setup();
    const onCloudBranchCommit = vi.fn();
    renderInTheme(
      <BranchSelector
        repoPath="owner/repo"
        currentBranch={null}
        workspaceMode="cloud"
        cloudBranches={[]}
        cloudBranchesLoading={true}
        cloudSearchQuery="brand-new-branch"
        onBranchSelect={vi.fn()}
        onCloudSearchChange={vi.fn()}
        onCloudBranchCommit={onCloudBranchCommit}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Branch" }));
    await user.click(
      await screen.findByText('Use "brand-new-branch" as branch name'),
    );

    expect(onCloudBranchCommit).toHaveBeenCalledTimes(1);
  });
});
