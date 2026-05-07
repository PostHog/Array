import {
  File,
  FolderSimple,
  GithubLogo,
  Paperclip,
} from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@posthog/quill";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { toast } from "@renderer/utils/toast";
import { isImageFile } from "@shared/constants/image";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  deriveFileLabel,
  type FileAttachment,
  type MentionChip,
} from "../utils/content";
import {
  persistBrowserFile,
  persistImageFilePath,
  resolveDroppedFile,
} from "../utils/persistFile";
import { IssuePicker } from "./IssuePicker";

interface AttachmentMenuProps {
  disabled?: boolean;
  repoPath?: string | null;
  onAddAttachment: (attachment: FileAttachment) => void;
  onAttachFiles?: (files: File[]) => void;
  onInsertChip: (chip: MentionChip) => void;
  iconSize?: number;
  attachTooltip?: string;
}

function getIssueDisabledReason(
  ghStatus: { installed: boolean; authenticated: boolean } | undefined,
  repoPath: string | null | undefined,
): string | null {
  if (!repoPath) return "Select a repository folder first.";
  if (!ghStatus) return "Checking GitHub CLI status...";
  if (!ghStatus.installed) return "Install GitHub CLI: `brew install gh`";
  if (!ghStatus.authenticated)
    return "Authenticate GitHub CLI with `gh auth login`";
  return null;
}

export function AttachmentMenu({
  disabled = false,
  repoPath,
  onAddAttachment,
  onAttachFiles,
  onInsertChip,
  iconSize = 14,
  attachTooltip = "Attach",
}: AttachmentMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [issuePickerOpen, setIssuePickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const paperclipRef = useRef<HTMLButtonElement>(null);

  const trpc = useTRPC();
  const { data: ghStatus } = useQuery(
    trpc.git.getGhStatus.queryOptions(undefined, {
      staleTime: 60_000,
    }),
  );

  const issueDisabledReason = getIssueDisabledReason(ghStatus, repoPath);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (files.length === 0) {
      return;
    }

    try {
      const attachments = await Promise.all(
        files.map(async (file) => {
          const resolved = await resolveDroppedFile(file);
          if (resolved) return resolved;

          return await persistBrowserFile(file);
        }),
      );

      for (const attachment of attachments) {
        if (attachment) {
          onAddAttachment(attachment);
        }
      }

      onAttachFiles?.(files);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to attach selected files from this picker",
      );
    }
  };

  const isWindows = window.navigator.platform.toLowerCase().startsWith("win");

  const pickAttachments = async (mode: "files" | "directories" | "both") => {
    setMenuOpen(false);

    try {
      const results = await trpcClient.os.selectAttachments.query({ mode });
      for (const { path: filePath, kind } of results) {
        if (kind === "file" && isImageFile(filePath)) {
          try {
            const attachment = await persistImageFilePath(filePath);
            onAddAttachment(attachment);
          } catch {
            toast.error("Failed to attach image");
          }
        } else {
          onInsertChip({
            type: kind === "directory" ? "folder" : "file",
            id: filePath,
            label: deriveFileLabel(filePath),
          });
        }
      }
      return;
    } catch {
      // Fall back to the input element for non-Electron environments.
    }

    fileInputRef.current?.click();
  };

  const handleAddFileOrFolder = () => pickAttachments("both");
  const handleAddFile = () => pickAttachments("files");
  const handleAddFolder = () => pickAttachments("directories");

  const handleOpenIssuePicker = () => {
    setMenuOpen(false);
    setIssuePickerOpen(true);
  };

  const handleIssueSelect = (chip: MentionChip) => {
    onInsertChip(chip);
    setIssuePickerOpen(false);
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              ref={paperclipRef}
              type="button"
              variant="default"
              size="icon-sm"
              disabled={disabled}
              aria-label={attachTooltip}
              title={attachTooltip}
            >
              <Paperclip size={iconSize} weight="bold" />
            </Button>
          }
        />
        <DropdownMenuContent
          align="start"
          side="top"
          sideOffset={6}
          className="min-w-[200px]"
        >
          {isWindows ? (
            <>
              <DropdownMenuItem onClick={handleAddFile}>
                <File size={14} weight="bold" />
                Add file
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleAddFolder}>
                <FolderSimple size={14} weight="bold" />
                Add folder
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onClick={handleAddFileOrFolder}>
              <File size={14} weight="bold" />
              Add file or folder
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={!!issueDisabledReason}
            onClick={handleOpenIssuePicker}
            title={issueDisabledReason ?? undefined}
          >
            <GithubLogo size={14} weight="bold" />
            Add issue or pull request
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <IssuePicker
        repoPath={repoPath ?? ""}
        open={issuePickerOpen}
        onOpenChange={setIssuePickerOpen}
        onSelect={handleIssueSelect}
        anchor={paperclipRef}
      />
    </>
  );
}
