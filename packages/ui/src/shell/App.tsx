import { ToastProvider } from "@posthog/quill";
import { EXTERNAL_LINKS, isNotAuthenticatedError } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { AiApprovalScreen } from "@posthog/ui/features/ai-approval/AiApprovalScreen";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import {
  useAuthStateValue,
  useCurrentUser,
} from "@posthog/ui/features/auth/authQueries";
import { AuthScreen } from "@posthog/ui/features/auth/components/AuthScreen";
import { InviteCodeScreen } from "@posthog/ui/features/auth/components/InviteCodeScreen";
import { ScopeReauthPrompt } from "@posthog/ui/features/auth/components/ScopeReauthPrompt";
import { useAuthSession } from "@posthog/ui/features/auth/useAuthSession";
import { useIsOrgAdmin } from "@posthog/ui/features/auth/useOrgRole";
import { CanvasGenerationToaster } from "@posthog/ui/features/canvas/freeform/useCanvasGenerationToasts";
import { AddDirectoryDialog } from "@posthog/ui/features/folder-picker/AddDirectoryDialog";
import { OnboardingFlow } from "@posthog/ui/features/onboarding/components/OnboardingFlow";
import { useOnboardingStore } from "@posthog/ui/features/onboarding/onboardingStore";
import { SettingsDialog } from "@posthog/ui/features/settings/SettingsDialog";
import { UpdateBanner } from "@posthog/ui/features/sidebar/components/UpdateBanner";
import { PendingPromptRecovery } from "@posthog/ui/features/task-detail/components/PendingPromptRecovery";
import { LoginTransition } from "@posthog/ui/primitives/LoginTransition";
import { router } from "@posthog/ui/router/router";
import { track } from "@posthog/ui/shell/analytics";
import { BootstrapFallback } from "@posthog/ui/shell/BootstrapFallback";
import { ErrorBoundary } from "@posthog/ui/shell/ErrorBoundary";
import { openExternalUrl } from "@posthog/ui/shell/openExternal";
import { useThemeStore } from "@posthog/ui/shell/themeStore";
import { useAppVisibilityWatchdog } from "@posthog/ui/shell/useAppVisibilityWatchdog";
import { Flex, Spinner, Text } from "@radix-ui/themes";
import { RouterProvider } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode, useEffect, useRef, useState } from "react";

interface AppProps {
  /** Host-provided dev diagnostics toolbar, docked below the app content. */
  devToolbar?: ReactNode;
}

function App({ devToolbar }: AppProps) {
  const { isBootstrapped } = useAuthSession();
  const authState = useAuthStateValue((state) => state);
  const hasCompletedOnboarding = useOnboardingStore(
    (state) => state.hasCompletedOnboarding,
  );
  const isAuthenticated = authState.status === "authenticated";
  const hasCodeAccess = authState.hasCodeAccess;
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const [showTransition, setShowTransition] = useState(false);
  const wasInMainApp = useRef(isAuthenticated && hasCompletedOnboarding);

  // Analytics init + dev inbox console moved to host CONTRIBUTIONs
  // (AnalyticsBootContribution / InboxDemoDevContribution), started by
  // boot at boot.

  // Workspace, focus, and agent event listeners moved to their feature
  // CONTRIBUTIONs (WorkspaceEventsContribution / FocusEventsContribution
  // / AgentEventsContribution), started by boot at boot.

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

  const wasShowingAiGateRef = useRef(false);
  useEffect(() => {
    if (wasShowingAiGateRef.current && !needsAiApproval && currentOrg != null) {
      track(ANALYTICS_EVENTS.AI_CONSENT_APPROVED);
    }
    wasShowingAiGateRef.current = needsAiApproval;
  }, [needsAiApproval, currentOrg]);

  const handleTransitionComplete = () => {
    setShowTransition(false);
  };

  const mainRef = useRef<HTMLDivElement>(null);
  // Mirrors the "main" branch of renderContent() below; keep the two in sync.
  const showingMainApp =
    isBootstrapped &&
    isAuthenticated &&
    hasCompletedOnboarding &&
    !isCheckingAccess &&
    !needsInviteCode &&
    !needsAiApproval;
  useAppVisibilityWatchdog(mainRef, showingMainApp);

  if (!isBootstrapped) {
    return <BootstrapFallback />;
  }

  // Rendering: onboarding (includes auth + invite code gate) → main app
  const renderContent = () => {
    if (!hasCompletedOnboarding) {
      return (
        <motion.div
          key="onboarding"
          initial={{ opacity: 1 }}
          className="h-full"
        >
          <OnboardingFlow />
        </motion.div>
      );
    }

    if (!isAuthenticated) {
      return (
        <motion.div key="auth" initial={{ opacity: 1 }} className="h-full">
          <AuthScreen />
        </motion.div>
      );
    }

    if (isCheckingAccess) {
      return (
        <motion.div
          key="access-check"
          initial={{ opacity: 1 }}
          className="h-full"
        >
          <Flex align="center" justify="center" height="100%">
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
        <motion.div
          key="invite-code"
          initial={{ opacity: 1 }}
          className="h-full"
        >
          <InviteCodeScreen />
        </motion.div>
      );
    }

    if (needsAiApproval) {
      return (
        <motion.div
          key="ai-approval"
          initial={{ opacity: 1 }}
          className="h-full"
        >
          <AiApprovalScreen
            orgName={currentOrg?.name ?? null}
            isAdmin={isAdmin}
            banner={<UpdateBanner variant="compact" />}
            onOpenSupport={() => openExternalUrl(EXTERNAL_LINKS.discord)}
            settingsDialog={<SettingsDialog />}
          />
        </motion.div>
      );
    }

    return (
      <motion.div key="main" ref={mainRef} className="app-fade-in h-full">
        <RouterProvider router={router} />
        {/* Surfaces a toast when a backgrounded canvas generation finishes,
            from anywhere in the app. Sibling of the router so it stays mounted
            across every route (not just the canvas space). Renders null. */}
        <CanvasGenerationToaster />
        <PendingPromptRecovery />
      </motion.div>
    );
  };

  const content = renderContent();

  return (
    <ToastProvider>
      <ErrorBoundary
        name="App"
        resetKey={authState.status}
        shouldSuppress={isNotAuthenticatedError}
      >
        <div className="flex h-screen flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden">
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
            <AddDirectoryDialog />
          </div>
          {devToolbar}
        </div>
      </ErrorBoundary>
    </ToastProvider>
  );
}

export default App;
