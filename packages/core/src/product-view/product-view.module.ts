import { ContainerModule } from "inversify";
import { PRODUCT_VIEW_SERVICE } from "./identifiers";
import { ProductViewService } from "./productView";

export const productViewCoreModule = new ContainerModule(({ bind }) => {
  bind(PRODUCT_VIEW_SERVICE).to(ProductViewService).inSingletonScope();
});
