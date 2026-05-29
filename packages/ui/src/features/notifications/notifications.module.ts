import { ContainerModule } from "inversify";
import { TaskNotificationService } from "./notifications";

export const notificationsUiModule = new ContainerModule(({ bind }) => {
  bind(TaskNotificationService).toSelf().inSingletonScope();
});
