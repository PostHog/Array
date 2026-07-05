import { ContainerModule } from "inversify";
import { SEAT_SERVICE } from "./identifiers";
import { SeatService } from "./seatService";

export const billingCoreModule = new ContainerModule(({ bind }) => {
  bind(SeatService).toSelf().inSingletonScope();
  bind(SEAT_SERVICE).toService(SeatService);
});
