import { CONTRIBUTION } from "@posthog/di/contribution";
import { ContainerModule } from "inversify";
import { ConnectivityEventsContribution } from "./connectivity-events.contribution";

export const connectivityUiModule = new ContainerModule(({ bind }) => {
  bind(CONTRIBUTION).to(ConnectivityEventsContribution).inSingletonScope();
});
