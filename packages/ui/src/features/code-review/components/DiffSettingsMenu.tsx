import { DotsThree } from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@posthog/quill";
import { useDiffViewerStore } from "@posthog/ui/features/code-editor/diffViewerStore";

export function DiffSettingsMenu() {
  const wordWrap = useDiffViewerStore((s) => s.wordWrap);
  const toggleWordWrap = useDiffViewerStore((s) => s.toggleWordWrap);
  const wordDiffs = useDiffViewerStore((s) => s.wordDiffs);
  const toggleWordDiffs = useDiffViewerStore((s) => s.toggleWordDiffs);
  const hideWhitespaceChanges = useDiffViewerStore(
    (s) => s.hideWhitespaceChanges,
  );
  const toggleHideWhitespaceChanges = useDiffViewerStore(
    (s) => s.toggleHideWhitespaceChanges,
  );
  const showReviewComments = useDiffViewerStore((s) => s.showReviewComments);
  const toggleShowReviewComments = useDiffViewerStore(
    (s) => s.toggleShowReviewComments,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon-sm"
            aria-label="Diff settings"
            className="rounded-xs"
          >
            <DotsThree size={16} weight="bold" />
          </Button>
        }
      />
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={6}
        className="min-w-[180px]"
      >
        <DropdownMenuItem onClick={toggleWordWrap}>
          {wordWrap ? "Disable word wrap" : "Enable word wrap"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={toggleWordDiffs}>
          {wordDiffs ? "Disable word diffs" : "Enable word diffs"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={toggleHideWhitespaceChanges}>
          {hideWhitespaceChanges ? "Show whitespace" : "Hide whitespace"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={toggleShowReviewComments}>
          {showReviewComments ? "Hide review comments" : "Show review comments"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
