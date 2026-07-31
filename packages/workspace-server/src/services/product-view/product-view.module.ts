import { ContainerModule } from "inversify";
import {
  PRODUCT_CODE_CONTEXT_SERVICE,
  PRODUCT_ENVIRONMENTS_SERVICE,
} from "../../di/tokens";
import { ProductCodeContextService } from "./code-context";
import { ProductEnvironmentsService } from "./service";

export const productEnvironmentsModule = new ContainerModule(({ bind }) => {
  bind(PRODUCT_ENVIRONMENTS_SERVICE)
    .to(ProductEnvironmentsService)
    .inSingletonScope();
  bind(PRODUCT_CODE_CONTEXT_SERVICE)
    .to(ProductCodeContextService)
    .inSingletonScope();
});
