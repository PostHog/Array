import { Button, type ButtonProps } from "@components/ui/Button";
import { Tooltip as ActionTooltip } from "@components/ui/Tooltip";
import { useInboxBulkActions } from "@features/inbox/hooks/useInboxBulkActions";
import { useInboxSignalsFilterStore } from "@features/inbox/stores/inboxSignalsFilterStore";
import { INBOX_REFETCH_INTERVAL_MS } from "@features/inbox/utils/inboxConstants";
import {
  ArrowClockwiseIcon,
  DotsThree,
  EyeSlashIcon,
  GearSixIcon,
  MagnifyingGlass,
  PauseIcon,
  ThumbsDownIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@posthog/quill";
import {
  AlertDialog,
  Box,
  Checkbox,
  Flex,
  Spinner,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import type { SignalReport } from "@shared/types";
import type { InboxReportActionProperties } from "@shared/types/analytics";
import type { ReactNode } from "react";
import { useState } from "react";
import { FilterSortMenu } from "./FilterSortMenu";
import { SuggestedReviewerFilterMenu } from "./SuggestedReviewerFilterMenu";

interface SignalsToolbarProps {
  totalCount: number;
  filteredCount: number;
  isSearchActive: boolean;
  livePolling?: boolean;
  isFetching?: boolean;
  readyCount?: number;
  processingCount?: number;
  pipelinePausedUntil?: string | null;
  searchDisabledReason?: string | null;
  hideFilters?: boolean;
  reports?: SignalReport[];
  /** Pre-computed effective bulk selection (store ids or virtual open-report fallback). */
  effectiveBulkIds?: string[];
  /** Called when the select-all checkbox is toggled. Parent owns all state transitions. */
  onToggleSelectAll?: (checked: boolean) => void;
  /** Called when the "Configure sources" button is clicked. */
  onConfigureSources?: () => void;
  /**
   * Opens the dismiss flow: exactly one report selected (snooze or permanent suppress, with a reason).
   * With 2+ reports selected, use the Snooze and Suppress toolbar actions instead.
   */
  onOpenDismissDialog?: () => void;
  /** True while the single-report dismiss dialog has a mutation in flight for this toolbar. */
  isDismissMutationPending?: boolean;
  /** Optional analytics callback fired when a bulk action succeeds. */
  onReportAction?: (
    action: Omit<InboxReportActionProperties, "rank" | "list_size"> & {
      rank?: number;
      list_size?: number;
    },
  ) => void;
}

function formatPauseRemaining(pausedUntil: string): string {
  const diffMs = new Date(pausedUntil).getTime() - Date.now();

  if (diffMs <= 0) {
    return "resuming soon";
  }

  const totalMinutes = Math.ceil(diffMs / 60_000);

  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;

  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

const inboxLivePollingTooltip = `Inbox is focused – syncing reports every ${Math.round(INBOX_REFETCH_INTERVAL_MS / 1000)}s…`;

function bulkMenuItemTooltip(
  explanationWhenEnabled: string,
  headlineWhenDisabled: string,
  disabled: boolean,
  disabledReason: string | null | undefined,
): ReactNode {
  const reason =
    disabled && disabledReason != null && disabledReason !== ""
      ? disabledReason.trim().replace(/\.$/, "")
      : null;
  if (reason) {
    return (
      <Flex direction="column" gap="2" className="max-w-[280px]">
        <Text as="span" className="text-(--gray-12) text-[13px]">
          {headlineWhenDisabled}
        </Text>
        <Text as="span" color="gray" className="text-[13px] leading-[1.45]">
          Disabled because {reason}.
        </Text>
      </Flex>
    );
  }
  return (
    <Text
      as="span"
      className="block max-w-[280px] text-(--gray-12) text-[13px] leading-[1.45]"
    >
      {explanationWhenEnabled}
    </Text>
  );
}

type InboxBulkActionButtonProps = Pick<
  ButtonProps,
  "tooltipContent" | "disabledReason" | "disabled" | "onClick"
> & {
  color: NonNullable<ButtonProps["color"]>;
  loading: boolean;
  icon: ReactNode;
  label: string;
};

function InboxBulkActionButton({
  color,
  loading,
  icon,
  label,
  tooltipContent,
  disabledReason,
  disabled,
  onClick,
}: InboxBulkActionButtonProps) {
  return (
    <Button
      type="button"
      size="1"
      variant="soft"
      color={color}
      className="text-[12px]"
      tooltipContent={tooltipContent}
      disabledReason={disabledReason}
      disabled={disabled}
      onClick={onClick}
    >
      {loading ? <Spinner size="1" /> : icon}
      {label}
    </Button>
  );
}

interface BulkOverflowMenuItemProps {
  /** Shown as the first line when the item is disabled (with reason below). */
  menuPrimary: string;
  /** Shown on hover when the item is enabled; explains what the action does. */
  tooltipExplanation: string;
  disabled: boolean;
  disabledReason: string | null | undefined;
  destructive?: boolean;
  loading: boolean;
  icon: ReactNode;
  label: string;
  onSelect?: () => void;
}

function BulkOverflowMenuItem({
  menuPrimary,
  tooltipExplanation,
  disabled,
  disabledReason,
  destructive = false,
  loading,
  icon,
  label,
  onSelect,
}: BulkOverflowMenuItemProps) {
  const tooltip = bulkMenuItemTooltip(
    tooltipExplanation,
    menuPrimary,
    disabled,
    disabledReason,
  );
  const content = (
    <span className="flex items-center gap-2">
      {loading ? <Spinner size="1" /> : icon}
      {label}
    </span>
  );
  const variant = destructive ? "destructive" : undefined;

  if (disabled) {
    return (
      <ActionTooltip side="right" align="start" content={tooltip}>
        <span
          className={`inline-flex w-full cursor-not-allowed opacity-50 ${destructive ? "text-(--red-11)" : "text-gray-10"}`}
        >
          <DropdownMenuItem
            className="pointer-events-none w-full"
            disabled
            variant={variant}
          >
            {content}
          </DropdownMenuItem>
        </span>
      </ActionTooltip>
    );
  }

  return (
    <ActionTooltip side="right" align="start" content={tooltip}>
      <DropdownMenuItem
        variant={variant}
        className={
          destructive
            ? "w-full text-(--red-11) [&_svg]:text-(--red-11)"
            : "w-full"
        }
        onClick={() => {
          onSelect?.();
        }}
      >
        {content}
      </DropdownMenuItem>
    </ActionTooltip>
  );
}

export function SignalsToolbar({
  totalCount,
  filteredCount,
  isSearchActive,
  livePolling = false,
  isFetching = false,
  readyCount,
  processingCount = 0,
  pipelinePausedUntil,
  searchDisabledReason,
  hideFilters,
  reports = [],
  effectiveBulkIds = [],
  onToggleSelectAll,
  onConfigureSources,
  onOpenDismissDialog,
  isDismissMutationPending = false,
  onReportAction,
}: SignalsToolbarProps) {
  const searchQuery = useInboxSignalsFilterStore((s) => s.searchQuery);
  const setSearchQuery = useInboxSignalsFilterStore((s) => s.setSearchQuery);
  const [showSnoozeConfirm, setShowSnoozeConfirm] = useState(false);
  const [showBulkSuppressConfirm, setShowBulkSuppressConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);

  const {
    selectedCount,
    snoozeDisabledReason,
    suppressDisabledReason,
    deleteDisabledReason,
    reingestDisabledReason,
    isSuppressing,
    isSnoozing,
    isDeleting,
    isReingesting,
    snoozeSelected,
    suppressSelected,
    deleteSelected,
    reingestSelected,
  } = useInboxBulkActions(reports, effectiveBulkIds);

  const countLabel = isSearchActive
    ? `${filteredCount} of ${totalCount}`
    : `${totalCount}`;

  const pipelineHintParts = [
    readyCount != null && processingCount > 0
      ? `${readyCount} up for review • ${processingCount} in research pipeline`
      : null,
    pipelinePausedUntil
      ? `Pipeline paused · resumes in ${formatPauseRemaining(pipelinePausedUntil)}`
      : null,
  ].filter(Boolean);

  const pipelineHint =
    pipelineHintParts.length > 0 ? pipelineHintParts.join(" · ") : null;

  const multiSelectBulkActions = selectedCount > 1;

  const singleDismissDisabledReason =
    selectedCount === 0
      ? snoozeDisabledReason
      : snoozeDisabledReason !== null && suppressDisabledReason !== null
        ? `${suppressDisabledReason} · ${snoozeDisabledReason}`
        : null;

  const reingestMenuPrimary =
    selectedCount > 1
      ? "Reingest selected reports to gather more context"
      : "Reingest this report to gather more context";

  const reingestTooltipExplanation =
    selectedCount > 1
      ? "Runs the signals pipeline again for each selected report to pull in refreshed context and observations."
      : "Runs the signals pipeline again for this report to pull in refreshed context and observations.";

  const deleteMenuPrimary =
    selectedCount > 1
      ? "Delete selected reports and their signals"
      : "Delete this report and its signals";

  const deleteTooltipExplanation =
    selectedCount > 1
      ? "Permanently removes these inbox reports and their linked signal data from your project."
      : "Permanently removes this inbox report and its linked signal data from your project.";

  const deleteConfirmTitle =
    selectedCount > 1 ? "Delete reports" : "Delete report";
  const deleteConfirmDescription =
    selectedCount > 1
      ? "Permanently delete these reports and their signals?"
      : "Permanently delete this report and its signals?";

  /**
   * Snapshot of the visible list captured at action-confirm time, so analytics
   * record rank + list_size as the user saw them — not the post-mutation refetch.
   */
  type ListSnapshot = {
    rankById: Map<string, number>;
    listSize: number;
  };
  const snapshotList = (): ListSnapshot => ({
    rankById: new Map(reports.map((r, i) => [r.id, i] as const)),
    listSize: reports.length,
  });

  const fireBulkAction = (
    actionType: InboxReportActionProperties["action_type"],
    targetIds: string[],
    snapshot: ListSnapshot,
  ) => {
    if (!onReportAction) return;
    const isBulk = targetIds.length > 1;
    const reportById = new Map(reports.map((r) => [r.id, r]));
    for (const reportId of targetIds) {
      const target = reportById.get(reportId);
      const createdAt = target?.created_at;
      const ageMs = createdAt
        ? Date.now() - new Date(createdAt).getTime()
        : Number.NaN;
      const reportAgeHours = Number.isFinite(ageMs)
        ? Math.max(0, Math.round((ageMs / 3_600_000) * 10) / 10)
        : 0;
      onReportAction({
        report_id: reportId,
        report_title: target?.title ?? null,
        report_age_hours: reportAgeHours,
        action_type: actionType,
        surface: "toolbar",
        is_bulk: isBulk,
        bulk_size: targetIds.length,
        rank: snapshot.rankById.get(reportId) ?? -1,
        list_size: snapshot.listSize,
      });
    }
  };

  const handleConfirmDelete = async () => {
    const targetIds = [...effectiveBulkIds];
    const snapshot = snapshotList();
    const ok = await deleteSelected();
    if (ok) {
      fireBulkAction("delete", targetIds, snapshot);
      setShowDeleteConfirm(false);
    }
  };

  const handleConfirmSnooze = async () => {
    const targetIds = [...effectiveBulkIds];
    const snapshot = snapshotList();
    const ok = await snoozeSelected();
    if (ok) {
      fireBulkAction("snooze", targetIds, snapshot);
      setShowSnoozeConfirm(false);
    }
  };

  const handleConfirmBulkSuppress = async () => {
    const targetIds = [...effectiveBulkIds];
    const snapshot = snapshotList();
    const ok = await suppressSelected();
    if (ok) {
      fireBulkAction("dismiss", targetIds, snapshot);
      setShowBulkSuppressConfirm(false);
    }
  };

  const handleReingest = async () => {
    const targetIds = [...effectiveBulkIds];
    const snapshot = snapshotList();
    const ok = await reingestSelected();
    if (ok) {
      fireBulkAction("reingest", targetIds, snapshot);
    }
  };

  const visibleReportIds = reports.map((report) => report.id);
  const hasVisibleReports = visibleReportIds.length > 0;
  const selectedVisibleCount = visibleReportIds.filter((reportId) =>
    effectiveBulkIds.includes(reportId),
  ).length;
  const allVisibleSelected =
    hasVisibleReports && selectedVisibleCount === visibleReportIds.length;
  const someVisibleSelected =
    selectedVisibleCount > 0 && selectedVisibleCount < visibleReportIds.length;

  return (
    <>
      <Flex
        direction="column"
        gap="2"
        className="select-none border-b border-b-(--gray-5) p-[8px]"
      >
        <Flex align="center" justify="between" gap="2">
          <Flex direction="column" gap="0" className="min-w-0">
            <Flex align="center" gap="2">
              <Text color="gray" className="shrink-0 text-[12px]">
                Reports ({countLabel})
              </Text>
              {livePolling ? (
                <Tooltip content={inboxLivePollingTooltip}>
                  <span
                    role="img"
                    className="inline-flex h-1.5 w-1.5 shrink-0 cursor-default rounded-full bg-(--red-9)"
                    style={{
                      boxShadow: isFetching
                        ? "0 0 6px var(--red-9)"
                        : "0 0 4px var(--red-9)",
                      opacity: isFetching ? 1 : 0.6,
                      transform: isFetching ? "scale(1.05)" : "scale(0.92)",
                      transition: isFetching
                        ? "opacity 0.15s ease-out, transform 0.15s ease-out, box-shadow 0.15s ease-out"
                        : "opacity 0.6s ease-in, transform 0.6s ease-in, box-shadow 0.6s ease-in",
                    }}
                    aria-label="Live inbox refresh active"
                  />
                </Tooltip>
              ) : null}
            </Flex>
            {pipelineHint && !isSearchActive ? (
              <Text color="gray" className="text-[11px] opacity-80">
                {pipelineHint}
              </Text>
            ) : null}
          </Flex>
          {onConfigureSources ? (
            <button
              type="button"
              onClick={onConfigureSources}
              className="flex shrink-0 cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[12px] text-gray-10 transition-colors hover:text-gray-12"
            >
              <GearSixIcon size={12} />
              <span>Configure sources</span>
            </button>
          ) : null}
        </Flex>

        <Flex align="center" gap="2">
          <Tooltip
            content={searchDisabledReason}
            hidden={!searchDisabledReason}
          >
            <Box className="min-w-0 flex-1 select-text">
              <TextField.Root
                size="1"
                placeholder="Search reports..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="text-[12px]"
                disabled={!!searchDisabledReason}
              >
                <TextField.Slot>
                  <MagnifyingGlass size={12} />
                </TextField.Slot>
              </TextField.Root>
            </Box>
          </Tooltip>
          {!hideFilters && (
            <Flex align="center" gap="1" className="shrink-0">
              <SuggestedReviewerFilterMenu />
              <FilterSortMenu />
            </Flex>
          )}
        </Flex>

        <Flex gap="2" align="center" justify="between" wrap="wrap-reverse">
          <Tooltip
            content={
              <>
                {allVisibleSelected || someVisibleSelected
                  ? "Click to unselect all"
                  : "Click to select all"}
                <br />
                Select items in bulk with Shift and {"\u2318"}
              </>
            }
          >
            {/* biome-ignore lint/a11y/noLabelWithoutControl: Radix Checkbox renders as button[role=checkbox] inside the label, which is valid */}
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                size="1"
                checked={
                  someVisibleSelected ? "indeterminate" : allVisibleSelected
                }
                disabled={!hasVisibleReports}
                onCheckedChange={(checked) =>
                  onToggleSelectAll?.(checked === true)
                }
                aria-label="Select all visible reports"
              />
              <Text color="gray" className="text-[11px]">
                {selectedCount} selected
              </Text>
            </label>
          </Tooltip>
          <Flex gap="2" align="center" wrap="wrap">
            <DropdownMenu
              open={moreActionsOpen}
              onOpenChange={setMoreActionsOpen}
            >
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label="More report actions"
                    className={`flex h-6 min-w-6 items-center justify-center gap-1 rounded-sm px-1.5 transition-colors hover:bg-gray-3 hover:text-gray-12 ${
                      moreActionsOpen
                        ? "bg-gray-3 text-gray-12"
                        : "text-gray-10"
                    }`}
                  >
                    <DotsThree size={14} weight="bold" />
                  </button>
                }
              />
              <DropdownMenuContent
                align="end"
                className="min-w-[180px] overflow-visible"
              >
                <BulkOverflowMenuItem
                  menuPrimary={reingestMenuPrimary}
                  tooltipExplanation={reingestTooltipExplanation}
                  disabled={reingestDisabledReason !== null || isReingesting}
                  disabledReason={reingestDisabledReason}
                  loading={isReingesting}
                  icon={<ArrowClockwiseIcon size={14} />}
                  label="Reingest"
                  onSelect={() => void handleReingest()}
                />
                <BulkOverflowMenuItem
                  menuPrimary={deleteMenuPrimary}
                  tooltipExplanation={deleteTooltipExplanation}
                  disabled={deleteDisabledReason !== null || isDeleting}
                  disabledReason={deleteDisabledReason}
                  destructive
                  loading={isDeleting}
                  icon={<TrashIcon size={14} />}
                  label="Delete"
                  onSelect={() => setShowDeleteConfirm(true)}
                />
              </DropdownMenuContent>
            </DropdownMenu>
            {multiSelectBulkActions ? (
              <>
                <InboxBulkActionButton
                  color="gray"
                  loading={isSnoozing}
                  icon={<PauseIcon size={12} />}
                  label="Snooze"
                  tooltipContent="Wait for selected reports to gather more context"
                  disabledReason={snoozeDisabledReason}
                  disabled={snoozeDisabledReason !== null || isSnoozing}
                  onClick={() => setShowSnoozeConfirm(true)}
                />
                <InboxBulkActionButton
                  color="gray"
                  loading={isSuppressing}
                  icon={<EyeSlashIcon size={12} />}
                  label="Suppress"
                  tooltipContent="Permanently suppress selected reports"
                  disabledReason={suppressDisabledReason}
                  disabled={suppressDisabledReason !== null || isSuppressing}
                  onClick={() => setShowBulkSuppressConfirm(true)}
                />
              </>
            ) : (
              <InboxBulkActionButton
                color="gray"
                loading={isDismissMutationPending}
                icon={<ThumbsDownIcon size={12} />}
                label="Dismiss"
                tooltipContent="Snooze or permanently dismiss"
                disabledReason={singleDismissDisabledReason}
                disabled={
                  singleDismissDisabledReason !== null ||
                  isDismissMutationPending
                }
                onClick={() => onOpenDismissDialog?.()}
              />
            )}
          </Flex>
        </Flex>
      </Flex>

      <AlertDialog.Root
        open={showSnoozeConfirm}
        onOpenChange={setShowSnoozeConfirm}
      >
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>
            <Flex align="center" gap="2">
              <PauseIcon size={18} />
              <Text className="font-bold">Snooze reports</Text>
            </Flex>
          </AlertDialog.Title>
          <AlertDialog.Description className="text-sm">
            <Text className="text-[13px]">
              Selected reports will go back to gathering context. You can review
              them again once they are ready. Continue?
            </Text>
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                variant="solid"
                color="gray"
                onClick={() => void handleConfirmSnooze()}
                disabled={isSnoozing}
              >
                {isSnoozing ? <Spinner size="1" /> : <PauseIcon size={14} />}
                Snooze
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={showBulkSuppressConfirm}
        onOpenChange={setShowBulkSuppressConfirm}
      >
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>
            <Flex align="center" gap="2">
              <EyeSlashIcon size={18} />
              <Text className="font-bold">Suppress reports</Text>
            </Flex>
          </AlertDialog.Title>
          <AlertDialog.Description className="text-sm">
            <Text className="text-[13px]">
              Suppressing a report causes all future signals matched to that
              report to be ignored. Are you sure?
            </Text>
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                variant="solid"
                color="orange"
                onClick={() => void handleConfirmBulkSuppress()}
                disabled={isSuppressing}
              >
                {isSuppressing ? (
                  <Spinner size="1" />
                ) : (
                  <EyeSlashIcon size={14} />
                )}
                Suppress
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
      >
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>
            <Flex align="center" gap="2">
              <TrashIcon size={18} />
              <Text className="font-bold">{deleteConfirmTitle}</Text>
            </Flex>
          </AlertDialog.Title>
          <AlertDialog.Description className="text-sm">
            <Text className="text-[13px]">{deleteConfirmDescription}</Text>
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                variant="solid"
                color="red"
                onClick={() => void handleConfirmDelete()}
                disabled={isDeleting}
              >
                {isDeleting ? <Spinner size="1" /> : <TrashIcon size={14} />}
                Delete
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
