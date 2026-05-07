import { ErrorBoundary } from "@components/ErrorBoundary";
import { LoginTransition } from "@components/LoginTransition";
import { MainLayout } from "@components/MainLayout";
import { ScopeReauthPrompt } from "@components/ScopeReauthPrompt";
import { AiApprovalScreen } from "@features/ai-approval/components/AiApprovalScreen";
import { AuthScreen } from "@features/auth/components/AuthScreen";
import { InviteCodeScreen } from "@features/auth/components/InviteCodeScreen";
import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import {
  useAuthStateValue,
  useCurrentUser,
} from "@features/auth/hooks/authQueries";
import { useAuthSession } from "@features/auth/hooks/useAuthSession";
import { useIsOrgAdmin } from "@features/auth/hooks/useOrgRole";
import { OnboardingFlow } from "@features/onboarding/components/OnboardingFlow";
import { useOnboardingStore } from "@features/onboarding/stores/onboardingStore";
import { Flex, Spinner, Text } from "@radix-ui/themes";
import { initializeConnectivityToast } from "@renderer/features/connectivity/connectivityToast";
import { initializeConnectivityStore } from "@renderer/stores/connectivityStore";
import { useFocusStore } from "@renderer/stores/focusStore";
import { useThemeStore } from "@renderer/stores/themeStore";
import { initializeUpdateStore } from "@renderer/stores/updateStore";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { initializePostHog, track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { toast } from "@utils/toast";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Toaster } from "sonner";

const log = logger.scope("app");

function App() {
  const trpcReact = useTRPC();
  const { isBootstrapped } = useAuthSession();
  const authState = useAuthStateValue((state) => state);
  const hasCompletedOnboarding = useOnboardingStore(
    (state) => state.hasCompletedOnboarding,
  );
  const selectedDirectory = useOnboardingStore(
    (state) => state.selectedDirectory,
  );
  const isAuthenticated = authState.status === "authenticated";
  const hasCodeAccess = authState.hasCodeAccess;
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const [showTransition, setShowTransition] = useState(false);
  const wasInMainApp = useRef(isAuthenticated && hasCompletedOnboarding);

  // Initialize PostHog analytics
  useEffect(() => {
    initializePostHog();
  }, []);

  // Initialize connectivity monitoring
  useEffect(() => {
    const disposeStore = initializeConnectivityStore();
    const disposeToast = initializeConnectivityToast();
    return () => {
      disposeToast();
      disposeStore();
    };
  }, []);

  // Initialize update store
  useEffect(() => {
    return initializeUpdateStore();
  }, []);

  // Dev-only inbox demo command for local QA from the renderer console.
  useEffect(() => {
    if (import.meta.env.PROD) {
      return;
    }

    void import("@features/inbox/devtools/inboxDemoConsole").then(
      ({ registerInboxDemoConsoleCommand }) => {
        registerInboxDemoConsoleCommand();
      },
    );
  }, []);

  // Global workspace error listener for toasts
  useEffect(() => {
    const subscription = trpcClient.workspace.onError.subscribe(undefined, {
      onData: (data) => {
        toast.error("Workspace error", { description: data.message });
      },
    });
    return () => subscription.unsubscribe();
  }, []);

  const queryClient = useQueryClient();

  useSubscription(
    trpcReact.workspace.onPromoted.subscriptionOptions(undefined, {
      onData: (data) => {
        void queryClient.invalidateQueries(
          trpcReact.workspace.getAll.pathFilter(),
        );
        toast.info(
          "Task moved to worktree",
          `Task is now working in its own worktree on branch "${data.fromBranch}"`,
        );
      },
    }),
  );

  useSubscription(
    trpcReact.workspace.onBranchChanged.subscriptionOptions(undefined, {
      onData: () => {
        void queryClient.invalidateQueries(
          trpcReact.workspace.getAll.pathFilter(),
        );
      },
    }),
  );

  useSubscription(
    trpcReact.workspace.onLinkedBranchChanged.subscriptionOptions(undefined, {
      onData: () => {
        void queryClient.invalidateQueries(
          trpcReact.workspace.getAll.pathFilter(),
        );
      },
    }),
  );

  useSubscription(
    trpcReact.focus.onBranchRenamed.subscriptionOptions(undefined, {
      onData: ({ worktreePath, newBranch }) => {
        useFocusStore.getState().updateSessionBranch(worktreePath, newBranch);
        void queryClient.invalidateQueries(
          trpcReact.workspace.getAll.pathFilter(),
        );
      },
    }),
  );

  useSubscription(
    trpcReact.agent.onAgentFileActivity.subscriptionOptions(undefined, {
      onData: (data) => {
        track(ANALYTICS_EVENTS.AGENT_FILE_ACTIVITY, {
          task_id: data.taskId,
          branch_name: data.branchName,
        });
      },
    }),
  );

  // Auto-unfocus when user manually checks out to a different branch
  useSubscription(
    trpcReact.focus.onForeignBranchCheckout.subscriptionOptions(undefined, {
      onData: async ({ focusedBranch, foreignBranch }) => {
        log.warn(
          `Foreign branch checkout detected: ${focusedBranch} -> ${foreignBranch}. Auto-unfocusing.`,
        );
        const result = await useFocusStore.getState().disableFocus();
        if (!result.success && result.error) {
          toast.error("Could not unfocus workspace", {
            description: result.error,
          });
        }
      },
    }),
  );

  const needsInviteCode =
    isAuthenticated && hasCodeAccess === false && hasCompletedOnboarding;
  const isCheckingAccess =
    isAuthenticated && hasCodeAccess === null && hasCompletedOnboarding;

  const authenticatedClient = useOptionalAuthenticatedClient();
  const { data: currentUser } = useCurrentUser({
    client: authenticatedClient,
    enabled:
      isAuthenticated && hasCompletedOnboarding && hasCodeAccess === true,
    refetchOnWindowFocus: "always",
  });
  const currentOrg = currentUser?.organization;
  const needsAiApproval =
    isAuthenticated &&
    hasCompletedOnboarding &&
    hasCodeAccess === true &&
    currentOrg != null &&
    currentOrg.is_ai_data_processing_approved !== true;
  const { isAdmin: isOrgAdmin } = useIsOrgAdmin();
  const isAdmin = isOrgAdmin === true;

  // Handle transition into main app — only show the dark overlay if dark mode is active
  useEffect(() => {
    const isInMainApp = isAuthenticated && hasCompletedOnboarding;
    if (!wasInMainApp.current && isInMainApp && isDarkMode) {
      setShowTransition(true);
    }
    if (!isAuthenticated) {
      setShowTransition(false);
    }
    wasInMainApp.current = isInMainApp;
  }, [isAuthenticated, hasCompletedOnboarding, isDarkMode]);

  const handleTransitionComplete = () => {
    setShowTransition(false);
  };

  if (!isBootstrapped) {
    return (
      <Flex align="center" justify="center" minHeight="100vh">
        <Flex align="center" gap="3">
          <Spinner size="3" />
          <Text color="gray">Loading...</Text>
        </Flex>
      </Flex>
    );
  }

  // Rendering: onboarding (includes auth + invite code gate) → main app
  // We also route to onboarding when no directory is selected — without one, the
  // main app has nothing meaningful to show (the dev "Skip setup" button can
  // produce this state by flipping hasCompletedOnboarding without picking a directory).
  const renderContent = () => {
    if (!hasCompletedOnboarding || !selectedDirectory) {
      return (
        <motion.div key="onboarding" initial={{ opacity: 1 }}>
          <OnboardingFlow />
        </motion.div>
      );
    }

    if (!isAuthenticated) {
      return (
        <motion.div key="auth" initial={{ opacity: 1 }}>
          <AuthScreen />
        </motion.div>
      );
    }

    if (isCheckingAccess) {
      return (
        <motion.div key="access-check" initial={{ opacity: 1 }}>
          <Flex align="center" justify="center" minHeight="100vh">
            <Flex align="center" gap="3">
              <Spinner size="3" />
              <Text color="gray">Checking access...</Text>
            </Flex>
          </Flex>
        </motion.div>
      );
    }

    if (needsInviteCode) {
      return (
        <motion.div key="invite-code" initial={{ opacity: 1 }}>
          <InviteCodeScreen />
        </motion.div>
      );
    }

    if (needsAiApproval) {
      return (
        <motion.div key="ai-approval" initial={{ opacity: 1 }}>
          <AiApprovalScreen
            orgName={currentOrg?.name ?? null}
            isAdmin={isAdmin}
          />
        </motion.div>
      );
    }

    return (
      <motion.div
        key="main"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: showTransition ? 1.5 : 0 }}
      >
        <MainLayout />
      </motion.div>
    );
  };

  const content = renderContent();

  return (
    <ErrorBoundary name="App">
      {isAuthenticated ? (
        <AnimatePresence mode="wait">{content}</AnimatePresence>
      ) : (
        content
      )}
      <LoginTransition
        isAnimating={showTransition}
        isDarkMode={isDarkMode}
        onComplete={handleTransitionComplete}
      />
      <ScopeReauthPrompt />
      <Toaster position="bottom-right" />
    </ErrorBoundary>
  );
}

export default App;
