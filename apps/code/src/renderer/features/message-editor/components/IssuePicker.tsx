import { useDebounce } from "@hooks/useDebounce";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@posthog/quill";
import { useTRPC } from "@renderer/trpc/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { GithubRefKind, GithubRefState } from "../types";
import type { MentionChip } from "../utils/content";
import {
  githubIssueToMentionChip,
  githubPullRequestToMentionChip,
} from "../utils/githubIssueChip";
import { IssueRow } from "./IssueRow";
import { SuggestionStatus } from "./SuggestionStatus";

interface IssuePickerProps {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (chip: MentionChip) => void;
  anchor: React.RefObject<HTMLElement | null>;
}

type Ref = {
  kind: GithubRefKind;
  number: number;
  title: string;
  url: string;
  repo: string;
  state: GithubRefState;
  labels: string[];
  isDraft?: boolean;
};

export function IssuePicker({
  repoPath,
  open,
  onOpenChange,
  onSelect,
  anchor,
}: IssuePickerProps) {
  const trpc = useTRPC();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, open ? 300 : 0);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const { data: refs = [], isFetching } = useQuery(
    trpc.git.searchGithubRefs.queryOptions(
      {
        directoryPath: repoPath,
        query: debouncedQuery || undefined,
        limit: 25,
      },
      { staleTime: 30_000, enabled: open && !!repoPath },
    ),
  );

  const isLoading = isFetching || (open && query !== debouncedQuery);

  const handleValueChange = (value: Ref | null) => {
    if (!value) return;
    onSelect(
      value.kind === "pr"
        ? githubPullRequestToMentionChip(value)
        : githubIssueToMentionChip(value),
    );
  };

  return (
    <Combobox<Ref>
      items={refs as Ref[]}
      open={open}
      onOpenChange={(nextOpen) => onOpenChange(nextOpen)}
      inputValue={query}
      onInputValueChange={(value) => setQuery(value ?? "")}
      onValueChange={(value) => handleValueChange(value as Ref | null)}
      filter={null}
    >
      <ComboboxContent
        anchor={anchor}
        side="top"
        align="start"
        sideOffset={6}
        className="min-w-[400px] p-0"
      >
        <ComboboxInput
          autoFocus
          showTrigger={false}
          placeholder="Search issues or pull requests..."
        />
        <ComboboxEmpty>
          <SuggestionStatus
            loading={isLoading}
            emptyMessage="No issues or pull requests found."
          />
        </ComboboxEmpty>
        <ComboboxList>
          {(ref: Ref) => (
            <ComboboxItem
              key={`${ref.kind}-${ref.number}`}
              value={ref}
              className="relative h-auto"
            >
              <IssueRow issue={ref} />
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
