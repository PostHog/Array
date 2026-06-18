import { exposeElectronTRPC } from "@posthog/electron-trpc/main";
import { contextBridge, webUtils } from "electron";
import "electron-log/preload";
import { parseSessionIdArg } from "./posthog-session-arg";

contextBridge.exposeInMainWorld("electronUtils", {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});

contextBridge.exposeInMainWorld("__posthogBootstrap", {
  sessionId: parseSessionIdArg(process.argv),
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
