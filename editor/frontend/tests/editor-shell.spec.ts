import { expect, test } from "@playwright/test";

test("editor shell renders", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 15000 });
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("editor-menubar")).toBeVisible();
  await expect(page.getByTestId("main-toolbar")).toBeVisible();
  await expect(page.getByTestId("dock-layout")).toBeVisible();

  await expect(page.getByTestId("panel-viewport")).toBeVisible();
  await expect(page.getByTestId("bevy-canvas-host")).toBeVisible();
  await expect(page.getByTestId("panel-world-outliner")).toBeVisible();
  await expect(page.getByTestId("panel-inspector")).toBeVisible();
  await expect(page.getByTestId("panel-asset-browser")).toBeVisible();
  await expect(page.getByTestId("bottom-dock")).toBeVisible();

  await expect(page.getByText("Console").first()).toBeVisible();
  await expect(page.getByText("Profiler").first()).toBeVisible();
  await expect(page.getByText("Agent Workbench").first()).toBeVisible();
});

test("selecting a mocked outliner item updates the inspector header", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("panel-world-outliner")).toBeVisible();
  await page.getByRole("button", { name: "Select Chunk 1,0" }).dispatchEvent("click");
  await expect(page.getByTestId("inspector-selection-header")).toHaveText("Chunk 1,0");
});

test("command palette creates an unbreakable protected area and toggles chunk bounds", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("protected-area-count")).toHaveText("3");
  await page.keyboard.press("Control+K");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.getByPlaceholder("Run editor command...").fill("unbreakable");
  await page.getByText("Create unbreakable box area").click();

  await expect(page.getByTestId("protected-area-count")).toHaveText("4");
  await expect(page.getByTestId("current-selection-label")).toHaveText("Unbreakable Box 4");
  await expect(page.getByTestId("inspector-selection-header")).toHaveText("Unbreakable Box 4");
  await expect(page.getByTestId("command-history-latest-id")).toHaveText("editor.area.createUnbreakableBox");

  await expect(page.getByTestId("chunk-bounds-state")).toHaveText("on");
  await page.locator('[data-command-id="editor.view.toggleChunkBounds"]').first().click();
  await expect(page.getByTestId("chunk-bounds-state")).toHaveText("off");
});
