import { exposeElectronTRPC } from "@posthog/electron-trpc/main";
import { contextBridge, webUtils } from "electron";
import "electron-log/preload";

contextBridge.exposeInMainWorld("electronUtils", {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});

if (process.argv.includes("--posthog-code-dev")) {
  contextBridge.exposeInMainWorld("__posthogCodeTest", {
    crash: () => {
      process.crash();
    },
    abort: () => {
      process.abort();
    },
  });
}

process.once("loaded", async () => {
  exposeElectronTRPC();
});
