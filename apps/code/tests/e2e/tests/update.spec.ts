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
  readBundleVersion,
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
const NEW_VERSION = "2.0.0";

test.describe("macOS auto-update", () => {
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
