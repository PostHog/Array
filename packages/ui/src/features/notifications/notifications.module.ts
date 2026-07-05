import { ContainerModule } from "inversify";
import { NotificationBus } from "./notifications";

export const notificationsUiModule = new ContainerModule(({ bind }) => {
  bind(NotificationBus).toSelf().inSingletonScope();
});
