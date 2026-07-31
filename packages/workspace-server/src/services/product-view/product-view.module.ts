import { ContainerModule } from "inversify";
import { PRODUCT_ENVIRONMENTS_SERVICE } from "../../di/tokens";
import { ProductEnvironmentsService } from "./service";

export const productEnvironmentsModule = new ContainerModule(({ bind }) => {
  bind(PRODUCT_ENVIRONMENTS_SERVICE)
    .to(ProductEnvironmentsService)
    .inSingletonScope();
});
