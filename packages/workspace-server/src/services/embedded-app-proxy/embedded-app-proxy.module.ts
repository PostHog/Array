import { ContainerModule } from "inversify";
import { EmbeddedAppProxyService } from "./embedded-app-proxy";
import { EMBEDDED_APP_PROXY_SERVICE } from "./identifiers";

export const embeddedAppProxyModule = new ContainerModule(({ bind }) => {
  bind(EMBEDDED_APP_PROXY_SERVICE)
    .to(EmbeddedAppProxyService)
    .inSingletonScope();
});
