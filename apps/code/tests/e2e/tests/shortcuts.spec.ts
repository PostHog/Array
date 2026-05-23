import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/electron";

const isMac = process.platform === "darwin";
const modKey = isMac ? "Meta" : "Control";

async function openShortcutsSheet(window: Page) {
  await window.keyboard.press(`${modKey}+Slash`);
  await window.getByText("Keyboard Combos").waitFor({ timeout: 5000 });
}

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

async function resetAllIfNeeded(window: Page) {
  try {
    await openShortcutsSheet(window);
    const resetBtn = window.getByText("Reset all shortcuts to defaults");
    const visible = await resetBtn.isVisible().catch(() => false);
    if (visible) await resetBtn.click();
    await window.keyboard.press("Escape");
  } catch {}
}

// Returns the chip button(s) for a named shortcut.
// Each individual binding renders as a separate button with this title pattern.
function getChips(window: Page, commandLabel: string) {
  return window.locator(
    `button[title='Click to edit binding for "${commandLabel}"']`,
  );
}

// Opens the recording modal via right-click → "Add another binding".
async function openAddRecording(window: Page, commandLabel: string) {
  await getChips(window, commandLabel).first().click({ button: "right" });
  await window.getByRole("menuitem", { name: "Add another binding" }).click();
  await window
    .getByText(`Add new binding for "${commandLabel}"`)
    .waitFor({ timeout: 3000 });
}

// Records a combo and confirms with Enter. Assumes the recording modal is already open.
async function recordAndConfirm(window: Page, combo: string) {
  await window.keyboard.press(combo);
  await window
    .getByText("Press Enter to confirm, Escape to cancel")
    .waitFor({ timeout: 2000 });
  await window.keyboard.press("Enter");
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

  // ─── Configurable vs non-configurable ─────────────────────────────────────

  test("configurable rows expose clickable chip buttons", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    // "Open command menu" is configurable
    await expect(getChips(window, "Open command menu").first()).toBeVisible();
  });

  test("non-configurable rows show a tooltip on hover", async ({ window }) => {
    await openShortcutsSheet(window);

    // "Switch to task 1-9" is intentionally non-configurable
    // The keycap wrapper has a Tooltip with this text; hover to reveal it
    await window.getByText("Switch to task 1-9").hover();
    await expect(
      window.getByText("This shortcut cannot be customized"),
    ).toBeVisible({ timeout: 2000 });
  });

  // ─── Recording modal ──────────────────────────────────────────────────────

  test("clicking a chip opens the recording modal in edit mode", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    await getChips(window, "Open inbox").first().click();
    await expect(window.getByText('Edit binding for "Open inbox"')).toBeVisible(
      { timeout: 3000 },
    );
    await expect(window.getByText("Press a key combination...")).toBeVisible();
  });

  test("pressing Escape cancels recording without closing the sheet", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    await getChips(window, "Open inbox").first().click();
    await window
      .getByText('Edit binding for "Open inbox"')
      .waitFor({ timeout: 3000 });

    await window.keyboard.press("Escape");

    // Modal closes, sheet stays open
    await expect(
      window.getByText('Edit binding for "Open inbox"'),
    ).not.toBeVisible();
    await expect(window.getByText("Keyboard Combos")).toBeVisible();
  });

  test("clicking the backdrop closes recording without saving", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    await getChips(window, "Open inbox").first().click();
    await window
      .getByText('Edit binding for "Open inbox"')
      .waitFor({ timeout: 3000 });

    // Click the blurred backdrop — the outer fixed overlay has a backdrop-filter style
    await window
      .locator('[style*="backdrop-filter"]')
      .click({ position: { x: 10, y: 10 } });

    await expect(
      window.getByText('Edit binding for "Open inbox"'),
    ).not.toBeVisible({ timeout: 2000 });
    await expect(window.getByText("Keyboard Combos")).toBeVisible();
  });

  test("bare letter key is ignored in recording mode", async ({ window }) => {
    await openShortcutsSheet(window);

    await getChips(window, "Open inbox").first().click();
    await window
      .getByText('Edit binding for "Open inbox"')
      .waitFor({ timeout: 3000 });

    await window.keyboard.press("k");

    // No combo captured — placeholder still shown, modal still open
    await expect(window.getByText("Press a key combination...")).toBeVisible();
    await expect(
      window.getByText('Edit binding for "Open inbox"'),
    ).toBeVisible();
  });

  test("Enter without a captured combo does not close the modal", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    await getChips(window, "Open inbox").first().click();
    await window
      .getByText('Edit binding for "Open inbox"')
      .waitFor({ timeout: 3000 });

    await window.keyboard.press("Enter");

    // Modal should still be open
    await expect(
      window.getByText('Edit binding for "Open inbox"'),
    ).toBeVisible();
  });

  // ─── Saving a binding ─────────────────────────────────────────────────────

  test("recording and pressing Enter saves the binding", async ({ window }) => {
    await openShortcutsSheet(window);

    await openAddRecording(window, "Open inbox");

    await window.keyboard.press("ControlOrMeta+Shift+Z");
    await window
      .getByText("Press Enter to confirm, Escape to cancel")
      .waitFor({ timeout: 2000 });
    await window.keyboard.press("Enter");

    // Modal closes
    await expect(
      window.getByText('Add new binding for "Open inbox"'),
    ).not.toBeVisible({ timeout: 3000 });

    // The chip for the shortcut should still be visible (now showing the new binding)
    await expect(getChips(window, "Open inbox").first()).toBeVisible();
  });

  test("right-click context menu offers Edit and Add another binding", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    await getChips(window, "Open inbox").first().click({ button: "right" });

    await expect(
      window.getByRole("menuitem", { name: "Edit binding" }),
    ).toBeVisible({ timeout: 2000 });
    await expect(
      window.getByRole("menuitem", { name: "Add another binding" }),
    ).toBeVisible();
  });

  test("can add a second binding via Add another binding", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    // Add first custom binding
    await openAddRecording(window, "Open inbox");
    await recordAndConfirm(window, "ControlOrMeta+Shift+Z");

    // Add second custom binding
    await getChips(window, "Open inbox").first().click({ button: "right" });
    await window.getByRole("menuitem", { name: "Add another binding" }).click();
    await window
      .getByText('Add new binding for "Open inbox"')
      .waitFor({ timeout: 3000 });
    await recordAndConfirm(window, "ControlOrMeta+Shift+X");

    // Two chips should now exist for this shortcut
    await expect(getChips(window, "Open inbox")).toHaveCount(2, {
      timeout: 3000,
    });
  });

  test("Add another binding option is absent at the 2-binding limit", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    // Fill both custom binding slots
    await openAddRecording(window, "Open inbox");
    await recordAndConfirm(window, "ControlOrMeta+Shift+Z");

    await getChips(window, "Open inbox").first().click({ button: "right" });
    await window.getByRole("menuitem", { name: "Add another binding" }).click();
    await recordAndConfirm(window, "ControlOrMeta+Shift+X");

    // Right-click again — "Add another binding" should be gone
    await getChips(window, "Open inbox").first().click({ button: "right" });
    await expect(
      window.getByRole("menuitem", { name: "Add another binding" }),
    ).not.toBeVisible({ timeout: 1000 });
  });

  // ─── Conflict detection ───────────────────────────────────────────────────

  test("pressing an already-used combo shows amber conflict message", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    await openAddRecording(window, "Open command menu");

    // mod+b is the default for "Toggle left sidebar"
    await window.keyboard.press(`${modKey}+b`);

    await expect(
      window.getByText(/Conflicts with "Toggle left sidebar"/),
    ).toBeVisible({ timeout: 3000 });
  });

  test("Enter is blocked while a conflict is shown", async ({ window }) => {
    await openShortcutsSheet(window);

    await openAddRecording(window, "Open command menu");

    await window.keyboard.press(`${modKey}+b`);
    await window
      .getByText(/Conflicts with "Toggle left sidebar"/)
      .waitFor({ timeout: 2000 });

    // Enter should NOT dismiss the modal while conflict is active
    await window.keyboard.press("Enter");
    await expect(
      window.getByText(/Conflicts with "Toggle left sidebar"/),
    ).toBeVisible();
  });

  test("resolving a conflict allows the binding to be saved", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    await openAddRecording(window, "Open command menu");

    // First press a conflicting key, then a safe one
    await window.keyboard.press(`${modKey}+b`);
    await window.getByText(/Conflicts with/).waitFor({ timeout: 2000 });

    await window.keyboard.press("ControlOrMeta+Shift+Z");
    await window
      .getByText("Press Enter to confirm, Escape to cancel")
      .waitFor({ timeout: 2000 });
    await window.keyboard.press("Enter");

    await expect(
      window.getByText('Add new binding for "Open command menu"'),
    ).not.toBeVisible({ timeout: 3000 });
  });

  // ─── Removing a binding ───────────────────────────────────────────────────

  test("right-click Remove binding removes a custom binding", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    await openAddRecording(window, "Open inbox");
    await recordAndConfirm(window, "ControlOrMeta+Shift+Z");

    // Add a second so we can remove one without hitting the single-binding guard
    await getChips(window, "Open inbox").first().click({ button: "right" });
    await window.getByRole("menuitem", { name: "Add another binding" }).click();
    await recordAndConfirm(window, "ControlOrMeta+Shift+X");

    await expect(getChips(window, "Open inbox")).toHaveCount(2, {
      timeout: 3000,
    });

    await getChips(window, "Open inbox").first().click({ button: "right" });
    await window.getByRole("menuitem", { name: "Remove binding" }).click();

    await expect(getChips(window, "Open inbox")).toHaveCount(1, {
      timeout: 3000,
    });
  });

  test("Remove binding is disabled and shows a tooltip when it is the only binding", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    // "Open inbox" has one default binding — Remove should be disabled
    await getChips(window, "Open inbox").first().click({ button: "right" });

    const removeItem = window.getByRole("menuitem", { name: "Remove binding" });
    // Radix disables items via aria-disabled or data-disabled
    const isDisabled =
      (await removeItem.getAttribute("aria-disabled")) === "true" ||
      (await removeItem.getAttribute("data-disabled")) !== null;
    expect(isDisabled).toBe(true);
  });

  // ─── Per-shortcut reset ───────────────────────────────────────────────────

  test("Reset to default is disabled when already at default", async ({
    window,
  }) => {
    await openShortcutsSheet(window);

    await getChips(window, "Open inbox").first().click({ button: "right" });

    const resetItem = window.getByRole("menuitem", {
      name: "Reset to default",
    });
    const isDisabled =
      (await resetItem.getAttribute("aria-disabled")) === "true" ||
      (await resetItem.getAttribute("data-disabled")) !== null;
    expect(isDisabled).toBe(true);
  });

  test("Reset to default reverts a customised shortcut", async ({ window }) => {
    await openShortcutsSheet(window);

    await openAddRecording(window, "Open inbox");
    await recordAndConfirm(window, "ControlOrMeta+Shift+Z");

    // Reset
    await getChips(window, "Open inbox").first().click({ button: "right" });
    await window.getByRole("menuitem", { name: "Reset to default" }).click();

    // Now Reset to default should be disabled again (back at default)
    await getChips(window, "Open inbox").first().click({ button: "right" });
    const resetItem = window.getByRole("menuitem", {
      name: "Reset to default",
    });
    const isDisabled =
      (await resetItem.getAttribute("aria-disabled")) === "true" ||
      (await resetItem.getAttribute("data-disabled")) !== null;
    expect(isDisabled).toBe(true);
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

    await openAddRecording(window, "Open inbox");
    await recordAndConfirm(window, "ControlOrMeta+Shift+Z");

    const resetAllBtn = window.getByText("Reset all shortcuts to defaults");
    await resetAllBtn.scrollIntoViewIfNeeded();
    await expect(resetAllBtn).toBeVisible();
  });

  test("clicking Reset all clears all custom bindings", async ({ window }) => {
    await openShortcutsSheet(window);

    await openAddRecording(window, "Open inbox");
    await recordAndConfirm(window, "ControlOrMeta+Shift+Z");

    await openAddRecording(window, "Open command menu");
    await recordAndConfirm(window, "ControlOrMeta+Shift+X");

    const resetAllBtn = window.getByText("Reset all shortcuts to defaults");
    await resetAllBtn.scrollIntoViewIfNeeded();
    await resetAllBtn.click();

    await expect(resetAllBtn).not.toBeVisible({ timeout: 3000 });
  });
});
