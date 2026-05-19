import {
  GitBranchDialog,
  GitCommitDialog,
} from "@features/git-interaction/components/GitInteractionDialogs";
import { useGitInteraction } from "@features/git-interaction/hooks/useGitInteraction";
import { useGitInteractionStore } from "@features/git-interaction/state/gitInteractionStore";
import { getSuggestedBranchName } from "@features/git-interaction/utils/getSuggestedBranchName";
import { DirtyTreeDialog } from "@features/sessions/components/DirtyTreeDialog";
import { HandoffConfirmDialog } from "@features/sessions/components/HandoffConfirmDialog";
import { useSessionForTask } from "@features/sessions/hooks/useSession";
import { getLocalHandoffService } from "@features/sessions/service/localHandoffService";
import { useHandoffDialogStore } from "@features/sessions/stores/handoffDialogStore";
import { useFeatureFlag } from "@hooks/useFeatureFlag";
import { Laptop, Spinner } from "@phosphor-icons/react";
import { Button as QuillButton } from "@posthog/quill";
import type { Task } from "@shared/types";
import { useState } from "react";

const CLOUD_HANDOFF_FLAG = "phc-cloud-handoff";

interface CloudGitInteractionHeaderProps {
  taskId: string;
  task: Task;
}

export function CloudGitInteractionHeader({
  taskId,
  task,
}: CloudGitInteractionHeaderProps) {
  const session = useSessionForTask(taskId);
  const localHandoff = getLocalHandoffService();
  const cloudHandoffEnabled =
    useFeatureFlag(CLOUD_HANDOFF_FLAG) || import.meta.env.DEV;

  const confirmOpen = useHandoffDialogStore((s) => s.confirmOpen);
  const direction = useHandoffDialogStore((s) => s.direction);
  const branchName = useHandoffDialogStore((s) => s.branchName);
  const dirtyTreeOpen = useHandoffDialogStore((s) => s.dirtyTreeOpen);
  const changedFiles = useHandoffDialogStore((s) => s.changedFiles);
  const closeConfirm = useHandoffDialogStore((s) => s.closeConfirm);
  const pendingAfterCommit = useHandoffDialogStore((s) => s.pendingAfterCommit);

  const commitRepoPath = pendingAfterCommit?.repoPath;
  const git = useGitInteraction(taskId, commitRepoPath);

  const [isPreflighting, setIsPreflighting] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setPreflightError(null);
    setIsPreflighting(true);
    try {
      await localHandoff.start(taskId, task);
    } catch (err) {
      setPreflightError(
        err instanceof Error ? err.message : "Preflight failed",
      );
    } finally {
      setIsPreflighting(false);
    }
  };

  const handleCommitAndContinue = async () => {
    localHandoff.hideDirtyTree();
    if (git.state.isFeatureBranch) {
      useGitInteractionStore.getState().actions.openCommit("commit");
      return;
    }

    useGitInteractionStore
      .getState()
      .actions.openBranch(getSuggestedBranchName(taskId, commitRepoPath));
  };

  const handleBranchConfirm = async () => {
    const branchCreated = await git.actions.runBranch();
    if (!branchCreated) return;
    useGitInteractionStore.getState().actions.openCommit("commit");
  };

  const handleCommitConfirm = async () => {
    const committed = await git.actions.runCommit();
    if (!committed) return;
    await localHandoff.resumePending();
  };

  if (!cloudHandoffEnabled) return null;

  const inProgress = session?.handoffInProgress ?? false;

  return (
    <>
      <div className="no-drag flex items-center">
        <QuillButton
          variant="outline"
          size="sm"
          disabled={inProgress}
          onClick={() =>
            localHandoff.openConfirm(taskId, session?.cloudBranch ?? null)
          }
        >
          {inProgress ? (
            <Spinner size={14} className="shrink-0 animate-spin" />
          ) : (
            <Laptop size={14} weight="regular" className="shrink-0" />
          )}
          {inProgress ? "Transferring..." : "Continue locally"}
        </QuillButton>
      </div>
      {confirmOpen && direction === "to-local" && (
        <HandoffConfirmDialog
          open={confirmOpen}
          onOpenChange={(open) => {
            if (!open) {
              closeConfirm();
              setPreflightError(null);
            }
          }}
          direction="to-local"
          branchName={branchName}
          onConfirm={handleConfirm}
          isSubmitting={isPreflighting}
          error={preflightError}
        />
      )}
      {dirtyTreeOpen && (
        <DirtyTreeDialog
          open={dirtyTreeOpen}
          onOpenChange={(open) => {
            if (!open) localHandoff.cancelPendingFlow();
          }}
          changedFiles={changedFiles}
          onCommitAndContinue={handleCommitAndContinue}
        />
      )}
      {pendingAfterCommit && (
        <GitCommitDialog
          open={git.modals.commitOpen}
          onOpenChange={(open) => {
            if (!open) {
              git.actions.closeCommit();
              localHandoff.cancelPendingFlow();
            }
          }}
          branchName={git.state.currentBranch ?? pendingAfterCommit.branchName}
          diffStats={git.state.diffStats}
          commitMessage={git.modals.commitMessage}
          onCommitMessageChange={git.actions.setCommitMessage}
          nextStep={git.modals.commitNextStep}
          onNextStepChange={git.actions.setCommitNextStep}
          pushDisabledReason={git.state.pushDisabledReason}
          onContinue={handleCommitConfirm}
          isSubmitting={git.modals.isSubmitting}
          error={git.modals.commitError}
          onGenerateMessage={git.actions.generateCommitMessage}
          isGeneratingMessage={git.modals.isGeneratingCommitMessage}
          showCommitAllToggle={
            git.state.stagedFiles.length > 0 &&
            git.state.unstagedFiles.length > 0
          }
          commitAll={git.modals.commitAll}
          onCommitAllChange={git.actions.setCommitAll}
          stagedFileCount={git.state.stagedFiles.length}
        />
      )}
      {pendingAfterCommit && (
        <GitBranchDialog
          open={git.modals.branchOpen}
          onOpenChange={(open) => {
            if (!open) {
              git.actions.closeBranch();
              localHandoff.cancelPendingFlow();
            }
          }}
          branchName={git.modals.branchName}
          onBranchNameChange={git.actions.setBranchName}
          onConfirm={handleBranchConfirm}
          isSubmitting={git.modals.isSubmitting}
          error={git.modals.branchError}
        />
      )}
    </>
  );
}
