import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { DiffStatsBadge } from "@features/code-review/components/DiffStatsBadge";
import { BranchSelector } from "@features/git-interaction/components/BranchSelector";
import { CloudGitInteractionHeader } from "@features/git-interaction/components/CloudGitInteractionHeader";
import { TaskActionsMenu } from "@features/git-interaction/components/TaskActionsMenu";
import { HandoffConfirmDialog } from "@features/sessions/components/HandoffConfirmDialog";
import { useSessionForTask } from "@features/sessions/hooks/useSession";
import { useSessionCallbacks } from "@features/sessions/hooks/useSessionCallbacks";
import { useHandoffDialogStore } from "@features/sessions/stores/handoffDialogStore";
import { SidebarTrigger } from "@features/sidebar/components/SidebarTrigger";
import { useSidebarStore } from "@features/sidebar/stores/sidebarStore";
import { SkillButtonsMenu } from "@features/skill-buttons/components/SkillButtonsMenu";
import { useWorkspace } from "@features/workspace/hooks/useWorkspace";
import { useFeatureFlag } from "@hooks/useFeatureFlag";
import { Cloud, Spinner } from "@phosphor-icons/react";
import { Button as QuillButton } from "@posthog/quill";
import { Box, Flex } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { useHeaderStore } from "@stores/headerStore";
import { useNavigationStore } from "@stores/navigationStore";
import { isWindows } from "@utils/platform";
import { useState } from "react";

const CLOUD_HANDOFF_FLAG = "phc-cloud-handoff";

function LocalHandoffButton({ taskId, task }: { taskId: string; task: Task }) {
  const session = useSessionForTask(taskId);
  const workspace = useWorkspace(taskId);
  const repoPath = workspace?.folderPath ?? null;
  const authStatus = useAuthStateValue((s) => s.status);
  const cloudHandoffEnabled =
    useFeatureFlag(CLOUD_HANDOFF_FLAG) || import.meta.env.DEV;
  const { initiateHandoffToCloud } = useSessionCallbacks({
    taskId,
    task,
    session: session ?? undefined,
    repoPath,
  });

  const confirmOpen = useHandoffDialogStore((s) => s.confirmOpen);
  const direction = useHandoffDialogStore((s) => s.direction);
  const branchName = useHandoffDialogStore((s) => s.branchName);
  const openConfirm = useHandoffDialogStore((s) => s.openConfirm);
  const closeConfirm = useHandoffDialogStore((s) => s.closeConfirm);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (authStatus !== "authenticated") return null;
  if (!cloudHandoffEnabled) return null;

  const handleConfirm = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      await initiateHandoffToCloud();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Handoff failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const inProgress = session?.handoffInProgress ?? false;

  return (
    <>
      <div className="no-drag flex items-center">
        <QuillButton
          variant="outline"
          size="sm"
          disabled={inProgress}
          onClick={() =>
            openConfirm(taskId, "to-cloud", workspace?.branchName ?? null)
          }
        >
          {inProgress ? (
            <Spinner size={14} className="shrink-0 animate-spin" />
          ) : (
            <Cloud size={14} weight="regular" className="shrink-0" />
          )}
          {inProgress ? "Transferring..." : "Continue in cloud"}
        </QuillButton>
      </div>
      {confirmOpen && direction === "to-cloud" && (
        <HandoffConfirmDialog
          open={confirmOpen}
          onOpenChange={(open) => {
            if (!open) {
              closeConfirm();
              setError(null);
            }
          }}
          direction="to-cloud"
          branchName={branchName}
          onConfirm={handleConfirm}
          isSubmitting={isSubmitting}
          error={error}
        />
      )}
    </>
  );
}

export const HEADER_HEIGHT = 36;
const COLLAPSED_WIDTH = 110;
const WINDOWS_TITLEBAR_INSET = 140;

export function HeaderRow() {
  const content = useHeaderStore((state) => state.content);
  const view = useNavigationStore((state) => state.view);

  const sidebarOpen = useSidebarStore((state) => state.open);
  const sidebarWidth = useSidebarStore((state) => state.width);
  const isResizing = useSidebarStore((state) => state.isResizing);
  const setIsResizing = useSidebarStore((state) => state.setIsResizing);

  const activeTaskId = view.type === "task-detail" ? view.data?.id : undefined;
  const activeWorkspace = useWorkspace(activeTaskId);
  const isCloudTask = activeWorkspace?.mode === "cloud";
  const showTaskSection = view.type === "task-detail";

  const handleLeftSidebarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <Flex
      align="center"
      className="drag border-b border-b-(--gray-6)"
      style={{
        height: `${HEADER_HEIGHT}px`,
        minHeight: `${HEADER_HEIGHT}px`,
        paddingRight: isWindows ? `${WINDOWS_TITLEBAR_INSET}px` : undefined,
      }}
    >
      <Flex
        align="center"
        justify="end"
        px="2"
        pr="3"
        style={{
          width: sidebarOpen ? `${sidebarWidth}px` : `${COLLAPSED_WIDTH}px`,
          minWidth: `${COLLAPSED_WIDTH}px`,
          transition: isResizing ? "none" : "width 0.2s ease-in-out",
        }}
        className="relative h-full border-r border-r-(--gray-6)"
      >
        <SidebarTrigger />
        {sidebarOpen && (
          <Box
            onMouseDown={handleLeftSidebarMouseDown}
            className="no-drag absolute top-0 right-0 bottom-0 w-[4px] cursor-col-resize bg-transparent"
            style={{
              zIndex: 100,
            }}
          />
        )}
      </Flex>

      {content && (
        <Flex
          align="center"
          justify="between"
          pl="3"
          className="h-full min-w-0 flex-1 overflow-hidden"
        >
          {content}
        </Flex>
      )}

      {showTaskSection && view.type === "task-detail" && view.data && (
        <Flex
          align="center"
          justify="end"
          gap="1"
          pr="1"
          pl="1"
          className="h-full max-w-[50%] shrink-0 overflow-hidden"
        >
          <div className="no-drag">
            <SkillButtonsMenu taskId={view.data.id} />
          </div>
          {activeWorkspace &&
            (activeWorkspace.branchName || activeWorkspace.baseBranch) && (
              <div className="no-drag flex h-full min-w-0 items-center">
                <BranchSelector
                  repoPath={
                    activeWorkspace.worktreePath ??
                    activeWorkspace.folderPath ??
                    null
                  }
                  currentBranch={
                    activeWorkspace.branchName ??
                    activeWorkspace.baseBranch ??
                    null
                  }
                  taskId={view.data.id}
                />
              </div>
            )}
          <DiffStatsBadge task={view.data} />

          {isCloudTask ? (
            <CloudGitInteractionHeader taskId={view.data.id} task={view.data} />
          ) : (
            <LocalHandoffButton taskId={view.data.id} task={view.data} />
          )}
          <TaskActionsMenu taskId={view.data.id} isCloud={isCloudTask} />
        </Flex>
      )}
    </Flex>
  );
}
