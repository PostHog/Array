import { CONTRIBUTION } from "@posthog/di/contribution";
import { ContainerModule } from "inversify";
import { MentionNotificationsContribution } from "./mentionNotifications.contribution";
import { NotificationBus } from "./notifications";
import { SpeechNotifier } from "./speechNotifier";

export const notificationsUiModule = new ContainerModule(({ bind }) => {
  bind(NotificationBus).toSelf().inSingletonScope();
  bind(SpeechNotifier).toSelf().inSingletonScope();
  bind(MentionNotificationsContribution).toSelf().inSingletonScope();
  bind(CONTRIBUTION).toService(MentionNotificationsContribution);
});
