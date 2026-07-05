import { SEAT_CLIENT } from "@posthog/core/billing/identifiers";
import { CONTRIBUTION } from "@posthog/di/contribution";
import { ContainerModule } from "inversify";
import { BillingContribution } from "./billing.contribution";
import { UiSeatClient } from "./seatClient";

export const billingUiModule = new ContainerModule(({ bind }) => {
  bind(CONTRIBUTION).to(BillingContribution).inSingletonScope();
  bind(SEAT_CLIENT).to(UiSeatClient).inSingletonScope();
});
