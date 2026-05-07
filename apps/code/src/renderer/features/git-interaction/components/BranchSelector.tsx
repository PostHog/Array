import { Tooltip } from "@components/ui/Tooltip";
import { useGitInteractionStore } from "@features/git-interaction/state/gitInteractionStore";
import { getSuggestedBranchName } from "@features/git-interaction/utils/getSuggestedBranchName";
import { invalidateGitBranchQueries } from "@features/git-interaction/utils/gitCacheKeys";
import {
  ArrowClockwise,
  CaretDown,
  GitBranch,
  Plus,
  Spinner,
} from "@phosphor-icons/react";
import {
  Button,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxListFooter,
  ComboboxTrigger,
} from "@posthog/quill";
import { useTRPC } from "@renderer/trpc";
import { toast } from "@renderer/utils/toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type RefObject, useEffect, useRef, useState } from "react";

const COMBOBOX_LIMIT = 50;

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 text-muted-foreground text-xs">
      <Spinner size={12} className="animate-spin" />
      {label}
    </div>
  );
}

interface BranchSelectorProps {
  repoPath: string | null;
  currentBranch: string | null;
  defaultBranch?: string | null;
  disabled?: boolean;
  loading?: boolean;
  variant?: "outline" | "ghost";
  workspaceMode?: "worktree" | "local" | "cloud";
  selectedBranch?: string | null;
  onBranchSelect?: (branch: string | null) => void;
  cloudBranches?: string[];
  cloudBranchesHasMore?: boolean;
  cloudBranchesLoading?: boolean;
  cloudBranchesFetchingMore?: boolean;
  cloudSearchQuery?: string;
  onCloudPickerOpen?: () => void;
  onCloudPickerClose?: () => void;
  onCloudSearchChange?: (value: string) => void;
  onCloudLoadMore?: () => void;
  onCloudBranchCommit?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  taskId?: string;
  anchor?: RefObject<HTMLElement | null>;
}

export function BranchSelector({
  repoPath,
  currentBranch,
  defaultBranch,
  disabled,
  loading,
  workspaceMode,
  selectedBranch,
  onBranchSelect,
  cloudBranches,
  cloudBranchesHasMore,
  cloudBranchesLoading,
  cloudBranchesFetchingMore,
  cloudSearchQuery,
  onCloudPickerOpen,
  onCloudPickerClose,
  onCloudSearchChange,
  onCloudLoadMore,
  onCloudBranchCommit,
  onRefresh,
  isRefreshing = false,
  taskId,
  anchor,
}: BranchSelectorProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const localAnchorRef = useRef<HTMLButtonElement>(null);
  const trpc = useTRPC();
  const { actions } = useGitInteractionStore();

  const isCloudMode = workspaceMode === "cloud";
  const isSelectionOnly = workspaceMode === "worktree" || isCloudMode;
  const displayedBranch = isSelectionOnly ? selectedBranch : currentBranch;

  useEffect(() => {
    if (isSelectionOnly && defaultBranch && !selectedBranch && onBranchSelect) {
      onBranchSelect(defaultBranch);
    }
  }, [isSelectionOnly, defaultBranch, selectedBranch, onBranchSelect]);

  const { data: localBranches = [], isLoading: localBranchesLoading } =
    useQuery(
      trpc.git.getAllBranches.queryOptions(
        { directoryPath: repoPath as string },
        { enabled: !isCloudMode && !!repoPath && open, staleTime: 10_000 },
      ),
    );

  const branches = isCloudMode ? (cloudBranches ?? []) : localBranches;
  const effectiveLoading = loading || (isCloudMode && cloudBranchesLoading);
  const cloudStillLoading =
    isCloudMode && cloudBranchesLoading && branches.length === 0 && !open;
  const branchListLoading = isCloudMode
    ? !!cloudBranchesLoading
    : localBranchesLoading;

  const checkoutMutation = useMutation(
    trpc.git.checkoutBranch.mutationOptions({
      onSuccess: () => {
        if (repoPath) invalidateGitBranchQueries(repoPath);
      },
      onError: (error, { branchName }) => {
        const message =
          error instanceof Error ? error.message : "Unknown error occurred";
        if (/would be overwritten by checkout/i.test(message)) {
          toast.error(`Can't switch to ${branchName}`, {
            description:
              "You have uncommitted changes that would be overwritten. Commit or stash them first.",
          });
          return;
        }
        toast.error(`Failed to checkout ${branchName}`, {
          description: message,
        });
      },
    }),
  );

  const handleBranchChange = (value: string | null) => {
    if (!value) return;
    if (isSelectionOnly) {
      onBranchSelect?.(value);
    } else if (value !== currentBranch) {
      checkoutMutation.mutate({
        directoryPath: repoPath as string,
        branchName: value,
      });
    }
    if (isCloudMode) {
      onCloudBranchCommit?.();
    }
    setOpen(false);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (isCloudMode && next) {
      onCloudPickerOpen?.();
    } else if (isCloudMode && !next) {
      onCloudPickerClose?.();
    }
  };

  const displayText = effectiveLoading
    ? "Loading..."
    : (displayedBranch ?? "No branch");

  const showSpinner =
    effectiveLoading || (isCloudMode && open && cloudBranchesFetchingMore);

  const isDisabled = !!(disabled || !repoPath || cloudStillLoading);
  const inputValue = isCloudMode ? (cloudSearchQuery ?? "") : searchQuery;

  return (
    <Combobox
      items={branches}
      limit={COMBOBOX_LIMIT}
      autoHighlight
      value={displayedBranch}
      inputValue={inputValue}
      onInputValueChange={
        isCloudMode
          ? (value) => onCloudSearchChange?.((value as string | null) ?? "")
          : setSearchQuery
      }
      onValueChange={(v) => handleBranchChange(v as string | null)}
      open={open}
      onOpenChange={handleOpenChange}
      disabled={isDisabled}
      filter={isCloudMode ? null : undefined}
    >
      <Tooltip
        content={displayedBranch ?? "Switch branch"}
        side="bottom"
        open={hovered && !open && !effectiveLoading}
      >
        <ComboboxTrigger
          render={
            <Button
              ref={localAnchorRef}
              variant="outline"
              size="sm"
              disabled={isDisabled}
              aria-label="Branch"
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              className="min-w-0 max-w-[250px] shrink"
            >
              {showSpinner ? (
                <Spinner size={14} className="shrink-0 animate-spin" />
              ) : (
                <GitBranch size={14} weight="regular" className="shrink-0" />
              )}
              <span className="min-w-0 truncate">{displayText}</span>
              <CaretDown
                size={10}
                weight="bold"
                className="text-muted-foreground"
              />
            </Button>
          }
        />
      </Tooltip>
      <ComboboxContent
        anchor={anchor ?? localAnchorRef}
        side="bottom"
        sideOffset={6}
        className="min-w-[240px]"
      >
        <div className="flex min-w-0 items-center gap-1 pe-2">
          <div className="min-w-0 flex-1">
            <ComboboxInput
              placeholder="Search branches..."
              showTrigger={false}
            />
          </div>
          {onRefresh ? (
            <Button
              variant="outline"
              size="sm"
              disabled={isDisabled || isRefreshing}
              aria-label="Refresh branches"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRefresh();
              }}
            >
              <ArrowClockwise
                size={14}
                className={isRefreshing ? "animate-spin" : undefined}
              />
            </Button>
          ) : null}
        </div>

        {isCloudMode && cloudBranchesFetchingMore ? (
          <LoadingRow label={`Loading more (${branches.length})…`} />
        ) : null}

        {branchListLoading && branches.length === 0 ? (
          <LoadingRow label="Loading branches…" />
        ) : (
          <ComboboxEmpty>No branches found.</ComboboxEmpty>
        )}

        <ComboboxList className="max-h-[min(14rem,calc(var(--available-height,14rem)-5rem))] pe-2">
          {(item: string) => (
            <ComboboxItem
              key={item}
              value={item}
              title={item}
              className="relative"
            >
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>

        {!isCloudMode ? (
          <button
            type="button"
            className="flex w-full items-center gap-2 border-t px-2 py-1.5 text-accent-foreground text-xs hover:bg-accent/10"
            onClick={() => {
              setOpen(false);
              actions.openBranch(
                taskId
                  ? getSuggestedBranchName(taskId, repoPath ?? undefined)
                  : undefined,
              );
            }}
          >
            <Plus size={11} weight="bold" />
            Create new branch
          </button>
        ) : null}

        {isCloudMode && cloudBranchesHasMore ? (
          <ComboboxListFooter>
            <div className="px-2 pb-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-center"
                disabled={cloudBranchesFetchingMore}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onCloudLoadMore?.();
                }}
              >
                {cloudBranchesFetchingMore ? (
                  <>
                    <Spinner size={14} className="animate-spin" />
                    Loading more…
                  </>
                ) : (
                  "Load more"
                )}
              </Button>
            </div>
          </ComboboxListFooter>
        ) : null}

        {!isCloudMode && branches.length > COMBOBOX_LIMIT ? (
          <div className="px-2 py-1.5 text-center text-muted-foreground text-xs">
            {searchQuery
              ? `Showing up to ${COMBOBOX_LIMIT} matches - refine your search`
              : `Showing ${COMBOBOX_LIMIT} of ${branches.length} - type to filter`}
          </div>
        ) : null}
      </ComboboxContent>
    </Combobox>
  );
}
