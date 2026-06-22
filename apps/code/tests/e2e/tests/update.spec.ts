import { existsSync } from "node:fs";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  test,
} from "@playwright/test";
import {
  FEED_DIR,
  isAppRunning,
  killApp,
  PRISTINE_APP,
  prepareRunApp,
  RUN_APP,
  RUN_APP_BIN,
  RUN_DIR,
  readBundleVersion,
  readMainLog,
  runningAppExecutables,
  SHIPIT_DIR,
  shipItEvidence,
  startFeedServer,
  waitUntil,
} from "../fixtures/update";

type UpdateStatus = {
  checking?: boolean;
  available?: boolean;
  availableVersion?: string;
  downloading?: boolean;
  downloadPercent?: number;
  updateReady?: boolean;
};

// Installed on globalThis by main/index.ts when POSTHOG_E2E_UPDATE_FEED is set.
// The cast is erased at compile time, so the evaluate closures serialize to plain
// globalThis access in the main process.
type E2eHook = {
  check: () => void;
  download: () => void;
  install: () => Promise<unknown>;
  status: () => UpdateStatus;
};
type Hooked = typeof globalThis & { __e2eUpdates: E2eHook };

const FEED_PORT = 8788;
const FEED_URL = `http://127.0.0.1:${FEED_PORT}`;
const OLD_VERSION = "1.0.0";
const NEW_VERSION = "2.0.0";

test.describe("macOS auto-update", () => {
  // Runs only via playwright.update.config.ts; the general e2e suite excludes
  // this file by path, so there is no env gate that could silently skip it.
  test.skip(process.platform !== "darwin", "macOS-only update flow");

  test("downloads, installs and relaunches into the new version", async () => {
    test.setTimeout(5 * 60_000);

    expect(
      existsSync(PRISTINE_APP),
      `missing built app at ${PRISTINE_APP}; run scripts/dev-update/build-pair.sh`,
    ).toBe(true);
    expect(
      existsSync(FEED_DIR),
      `missing feed at ${FEED_DIR}; run scripts/dev-update/build-pair.sh`,
    ).toBe(true);

    prepareRunApp();
    const feed = startFeedServer(FEED_PORT);

    try {
      // Phase 1: drive the real download + install on the old build.
      const app = await electron.launch({
        executablePath: RUN_APP_BIN,
        args: [],
        env: {
          ...process.env,
          ELECTRON_DISABLE_GPU: "1",
          POSTHOG_E2E_UPDATE_FEED: FEED_URL,
        },
      });

      await expect
        .poll(
          () => app.evaluate(() => typeof (globalThis as Hooked).__e2eUpdates),
          {
            timeout: 30_000,
            message: "update hook was never installed",
          },
        )
        .toBe("object");

      // Prove we actually start on the old version, so the swap is real.
      const startVersion = await app.evaluate(({ app: a }) => a.getVersion());
      expect(startVersion, "run app should start on the old version").toBe(
        OLD_VERSION,
      );

      await app.evaluate(() => (globalThis as Hooked).__e2eUpdates.check());
      await pollStatus(
        app,
        (s) => s.available === true && s.availableVersion === NEW_VERSION,
        "update never became available",
      );

      await app.evaluate(() => (globalThis as Hooked).__e2eUpdates.download());
      await pollStatus(
        app,
        (s) => s.updateReady === true,
        "update never finished downloading",
      );

      const closed = app.waitForEvent("close");
      void app
        .evaluate(() => {
          void (globalThis as Hooked).__e2eUpdates.install();
        })
        .catch(() => undefined);
      await closed;

      // Phase 2: prove the bundle swapped and a fresh launch is the new version.
      await waitUntil(
        () => readBundleVersion(RUN_APP) === NEW_VERSION,
        120_000,
        "bundle was not swapped to the new version",
      );

      // Squirrel relaunches the installed app (isForceRunAfter=true); confirm the
      // auto-relaunched process actually came up running from the swapped bundle.
      await waitUntil(
        () => runningAppExecutables().some((exe) => exe.includes(RUN_DIR)),
        60_000,
        "Squirrel did not auto-relaunch the updated app",
      );
      console.log(
        `Auto-relaunched from swapped bundle: ${runningAppExecutables().join(", ")}`,
      );

      killApp();
      await waitUntil(
        () => !isAppRunning(),
        30_000,
        "relaunched instance did not exit",
      );

      const updated = await electron.launch({
        executablePath: RUN_APP_BIN,
        args: [],
        env: { ...process.env, ELECTRON_DISABLE_GPU: "1" },
      });
      const version = await updated.evaluate(({ app: a }) => a.getVersion());
      expect(version).toBe(NEW_VERSION);
      await updated.close();

      // Mechanism evidence: our updater drove a real download and install, and
      // Squirrel.Mac's ShipIt is what performed the in-place swap.
      const mainLog = readMainLog();
      expect(
        mainLog,
        "main.log missing the completed-download marker",
      ).toContain("Update downloaded, awaiting user confirmation");
      expect(mainLog, "main.log missing the install marker").toContain(
        "Installing update and restarting",
      );
      const shipIt = shipItEvidence();
      console.log(
        `Squirrel ShipIt cache: exists=${shipIt.exists} entries=[${shipIt.entries.join(", ")}]`,
      );
      expect(
        shipIt.exists,
        `no Squirrel ShipIt cache at ${SHIPIT_DIR}; the swap was not performed by Squirrel`,
      ).toBe(true);
    } finally {
      feed.kill();
    }
  });
});

async function pollStatus(
  app: ElectronApplication,
  predicate: (status: UpdateStatus) => boolean,
  message: string,
): Promise<void> {
  await expect
    .poll(
      async () =>
        predicate(
          await app.evaluate(() =>
            (globalThis as Hooked).__e2eUpdates.status(),
          ),
        ),
      { timeout: 120_000, message },
    )
    .toBe(true);
}
