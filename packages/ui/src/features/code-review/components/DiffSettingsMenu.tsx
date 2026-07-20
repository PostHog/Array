import { DotsThree } from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@posthog/quill";
import { useDiffViewerStore } from "@posthog/ui/features/code-editor/diffViewerStore";

export type CommentFileFilter = "none" | "commented" | "unresolved";

interface DiffSettingsMenuProps {
  commentedFileCount: number;
  unresolvedCommentedFileCount: number;
  commentFilter: CommentFileFilter;
  onCommentFilterChange?: (filter: CommentFileFilter) => void;
}

export function DiffSettingsMenu({
  commentedFileCount,
  unresolvedCommentedFileCount,
  commentFilter,
  onCommentFilterChange,
}: DiffSettingsMenuProps) {
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
            variant={commentFilter === "none" ? "default" : "primary"}
            aria-label={
              commentFilter === "none"
                ? "Diff settings"
                : `Diff settings, ${commentFilter} comment filter active`
            }
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
        {onCommentFilterChange && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              Comment filter
              {commentFilter === "commented"
                ? " · All"
                : commentFilter === "unresolved"
                  ? " · Unresolved"
                  : ""}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent side="right" sideOffset={4}>
              <DropdownMenuRadioGroup
                value={commentFilter === "none" ? "" : commentFilter}
                onValueChange={(value) =>
                  onCommentFilterChange(value as CommentFileFilter)
                }
              >
                <DropdownMenuRadioItem value="commented">
                  All comments ({commentedFileCount})
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="unresolved">
                  Unresolved comments ({unresolvedCommentedFileCount})
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              {commentFilter !== "none" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onCommentFilterChange("none")}
                  >
                    Clear comment filter
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
