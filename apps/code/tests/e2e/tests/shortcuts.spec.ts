import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/electron";

const isMac = process.platform === "darwin";
const modKey = isMac ? "Meta" : "Control";

// Opens the shortcuts sheet via keyboard shortcut.
async function openShortcutsSheet(window: Page) {
  await window.keyboard.press(`${modKey}+Slash`);
  await window.getByText("Keyboard Combos").waitFor({ timeout: 5000 });
}

// Returns true when the main layout is rendered (requires authenticated state).
async function isMainLayout(window: Page): Promise<boolean> {
  await window.locator("#root > *").waitFor({ timeout: 30000 });
  await window
    .locator("text=Loading")
    .waitFor({ state: "hidden", timeout: 15000 })
    .catch(() => {});
  return window
    .locator("text=New task")
    .first()
    .isVisible()
    .catch(() => false);
}

// Clears all custom bindings via the Reset all button if it's visible.
async function resetAllIfNeeded(window: Page) {
  try {
    await openShortcutsSheet(window);
    const resetBtn = window.getByText("Reset all shortcuts to defaults");
    const visible = await resetBtn.isVisible().catch(() => false);
    if (visible) await resetBtn.click();
    await window.keyboard.press("Escape");
  } catch {}
}

test.describe("Configurable Keyboard Shortcuts", () => {
  test.beforeEach(async ({ window }) => {
    const ready = await isMainLayout(window);
    if (!ready) test.skip();
    await resetAllIfNeeded(window);
  });

  // ─── Sheet ────────────────────────────────────────────────────────────────

  test("shortcuts sheet opens via keyboard shortcut", async ({ window }) => {
    await openShortcutsSheet(window);

    await expect(window.getByText("Keyboard Combos")).toBeVisible();
    await expect(
      window.getByText("Your cheat codes for shipping faster"),
    ).toBeVisible();
  });

  test("shortcuts sheet shows all category sections", async ({ window }) => {
    await openShortcutsSheet(window);

    for (const label of ["General", "Navigation", "Panels & Tabs", "Editor"]) {
      await expect(window.getByText(label).first()).toBeVisible();
    }
  });

  // ─── Hover controls ───────────────────────────────────────────────────────

  test("hovering a configurable row reveals the add (+) button", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    await window.getByText("Open command menu").hover();
    await expect(window.getByTitle("Add binding").first()).toBeVisible();
  });

  test("non-configurable rows do not show an add (+) button", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    // "Switch to task 1-9" is intentionally non-configurable
    await window.getByText("Switch to task 1-9").hover();
    const addBtns = window.getByTitle("Add binding");
    expect(await addBtns.count()).toBe(0);
  });

  // ─── Recording ────────────────────────────────────────────────────────────

  test("clicking + enters recording mode", async ({ window }) => {
    await openShortcutsSheet(window);

    await window.getByText("Open inbox").hover();
    await window.getByTitle("Add binding").click();

    await expect(
      window.locator('input[aria-label="Press new shortcut"]'),
    ).toBeVisible();
  });

  test("pressing Escape cancels recording without closing the sheet", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    await window.getByText("Open inbox").hover();
    await window.getByTitle("Add binding").click();

    const input = window.locator('input[aria-label="Press new shortcut"]');
    await expect(input).toBeVisible();

    await window.keyboard.press("Escape");

    // Input should close…
    await expect(input).not.toBeVisible();
    // …but the sheet should stay open
    await expect(window.getByText("Keyboard Combos")).toBeVisible();
  });

  test("bare letter key is rejected in recording mode", async ({ window }) => {
    await openShortcutsSheet(window);

    await window.getByText("Open inbox").hover();
    await window.getByTitle("Add binding").click();

    const input = window.locator('input[aria-label="Press new shortcut"]');
    await expect(input).toBeVisible();

    // Press a bare letter with no modifier — should be ignored
    await window.keyboard.press("k");

    // Input should still be in recording mode (not closed)
    await expect(input).toBeVisible();
  });

  // ─── Saving a binding ─────────────────────────────────────────────────────

  test("recording a valid combo saves it and shows keycap + remove button", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    await window.getByText("Open inbox").hover();
    await window.getByTitle("Add binding").click();

    // Use ControlOrMeta+Shift+Z — not in the default shortcut set
    await window.keyboard.press("ControlOrMeta+Shift+Z");

    // Recording input should close
    await expect(
      window.locator('input[aria-label="Press new shortcut"]'),
    ).not.toBeVisible({ timeout: 3000 });

    // Remove and reset buttons should now be visible on hover
    await window.getByText("Open inbox").hover();
    await expect(window.getByTitle("Remove binding").first()).toBeVisible();
    await expect(window.getByTitle("Reset to default").first()).toBeVisible();
  });

  test("can add a second binding to the same shortcut", async ({ window }) => {
    await openShortcutsSheet(window);

    // Add first binding
    await window.getByText("Open inbox").hover();
    await window.getByTitle("Add binding").click();
    await window.keyboard.press("ControlOrMeta+Shift+Z");
    await window
      .locator('input[aria-label="Press new shortcut"]')
      .waitFor({ state: "hidden" });

    // Add second binding
    await window.getByText("Open inbox").hover();
    await window.getByTitle("Add binding").click();
    await window.keyboard.press("ControlOrMeta+Shift+X");
    await window
      .locator('input[aria-label="Press new shortcut"]')
      .waitFor({ state: "hidden" });

    // Both remove buttons should be visible (one per binding)
    await window.getByText("Open inbox").hover();
    const removeBtns = window.getByTitle("Remove binding");
    expect(await removeBtns.count()).toBe(2);
  });

  // ─── Conflict detection ───────────────────────────────────────────────────

  test("assigning an already-used combo shows a conflict toast", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    await window.getByText("Open command menu").hover();
    await window.getByTitle("Add binding").click();

    // mod+b is the default for "Toggle left sidebar"
    await window.keyboard.press(`${modKey}+b`);

    await expect(
      window.getByText('Already used by "Toggle left sidebar"'),
    ).toBeVisible({ timeout: 5000 });

    // Recording should be cancelled — no remove button
    await window.getByText("Open command menu").hover();
    await expect(window.getByTitle("Remove binding")).not.toBeVisible();
  });

  // ─── Removing a binding ───────────────────────────────────────────────────

  test("clicking × removes a custom binding", async ({ window }) => {
    await openShortcutsSheet(window);

    // Add a binding
    await window.getByText("Open inbox").hover();
    await window.getByTitle("Add binding").click();
    await window.keyboard.press("ControlOrMeta+Shift+Z");
    await window
      .locator('input[aria-label="Press new shortcut"]')
      .waitFor({ state: "hidden" });

    // Remove it
    await window.getByText("Open inbox").hover();
    await window.getByTitle("Remove binding").click();

    // Remove and reset buttons should now be gone
    await window.getByText("Open inbox").hover();
    await expect(window.getByTitle("Remove binding")).not.toBeVisible();
    await expect(window.getByTitle("Reset to default")).not.toBeVisible();
  });

  // ─── Per-shortcut reset ───────────────────────────────────────────────────

  test("↩ resets an individual shortcut to its default", async ({ window }) => {
    await openShortcutsSheet(window);

    // Add a binding
    await window.getByText("Open inbox").hover();
    await window.getByTitle("Add binding").click();
    await window.keyboard.press("ControlOrMeta+Shift+Z");
    await window
      .locator('input[aria-label="Press new shortcut"]')
      .waitFor({ state: "hidden" });

    // Reset this shortcut
    await window.getByText("Open inbox").hover();
    await window.getByTitle("Reset to default").click();

    // Should revert — no custom controls visible
    await window.getByText("Open inbox").hover();
    await expect(window.getByTitle("Reset to default")).not.toBeVisible();
    await expect(window.getByTitle("Remove binding")).not.toBeVisible();
  });

  // ─── Reset all ────────────────────────────────────────────────────────────

  test("Reset all button is hidden when no custom bindings exist", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    await expect(
      window.getByText("Reset all shortcuts to defaults"),
    ).not.toBeVisible();
  });

  test("Reset all button appears after adding a custom binding", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    await window.getByText("Open inbox").hover();
    await window.getByTitle("Add binding").click();
    await window.keyboard.press("ControlOrMeta+Shift+Z");
    await window
      .locator('input[aria-label="Press new shortcut"]')
      .waitFor({ state: "hidden" });

    // Scroll to bottom to find the button
    const resetAllBtn = window.getByText("Reset all shortcuts to defaults");
    await resetAllBtn.scrollIntoViewIfNeeded();
    await expect(resetAllBtn).toBeVisible();
  });

  test("clicking Reset all clears all custom bindings", async ({ window }) => {
    await openShortcutsSheet(window);

    // Add bindings to two different shortcuts
    await window.getByText("Open inbox").hover();
    await window.getByTitle("Add binding").click();
    await window.keyboard.press("ControlOrMeta+Shift+Z");
    await window
      .locator('input[aria-label="Press new shortcut"]')
      .waitFor({ state: "hidden" });

    await window.getByText("Open command menu").hover();
    await window.getByTitle("Add binding").click();
    await window.keyboard.press("ControlOrMeta+Shift+X");
    await window
      .locator('input[aria-label="Press new shortcut"]')
      .waitFor({ state: "hidden" });

    // Click Reset all
    const resetAllBtn = window.getByText("Reset all shortcuts to defaults");
    await resetAllBtn.scrollIntoViewIfNeeded();
    await resetAllBtn.click();

    // Button should disappear
    await expect(resetAllBtn).not.toBeVisible();

    // Neither row should have custom controls any more
    await window.getByText("Open inbox").hover();
    await expect(window.getByTitle("Remove binding")).not.toBeVisible();
  });
});
