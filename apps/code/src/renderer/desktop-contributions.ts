import { billingCoreModule } from "@posthog/core/billing/billing.module";
import { inboxCoreModule } from "@posthog/core/inbox/inbox.module";
import { onboardingModule } from "@posthog/core/onboarding/onboarding.module";
import { setupCoreModule } from "@posthog/core/setup/setup.module";
import { CONTRIBUTION } from "@posthog/di/contribution";
import { agentUiModule } from "@posthog/ui/features/agent/agent.module";
import { authUiModule } from "@posthog/ui/features/auth/auth.module";
import { billingUiModule } from "@posthog/ui/features/billing/billing.module";
import { cloneUiModule } from "@posthog/ui/features/clone/clone.module";
import { connectivityUiModule } from "@posthog/ui/features/connectivity/connectivity.module";
import { fileWatcherUiModule } from "@posthog/ui/features/file-watcher/file-watcher.module";
import { focusUiModule } from "@posthog/ui/features/focus/focus.module";
import { notificationsUiModule } from "@posthog/ui/features/notifications/notifications.module";
import { provisioningUiModule } from "@posthog/ui/features/provisioning/provisioning.module";
import { setupUiModule } from "@posthog/ui/features/setup/setup.module";
import { workspaceUiModule } from "@posthog/ui/features/workspace/workspace.module";
import {
  AnalyticsBootContribution,
  InboxDemoDevContribution,
} from "@renderer/contributions/app-boot.contributions";
import { container } from "@renderer/di/container";

export function registerDesktopContributions(): void {
  for (const module of [
    agentUiModule,
    authUiModule,
    billingUiModule,
    billingCoreModule,
    cloneUiModule,
    connectivityUiModule,
    fileWatcherUiModule,
    focusUiModule,
    inboxCoreModule,
    notificationsUiModule,
    onboardingModule,
    provisioningUiModule,
    setupCoreModule,
    setupUiModule,
    workspaceUiModule,
  ]) {
    container.load(module);
  }

  container.bind(CONTRIBUTION).to(AnalyticsBootContribution).inSingletonScope();
  container.bind(CONTRIBUTION).to(InboxDemoDevContribution).inSingletonScope();
}
