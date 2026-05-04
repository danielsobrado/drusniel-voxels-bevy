import { statSync } from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const captureVerifiedScreenshot = async (page: Page, testInfo: TestInfo, name: string) => {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  expect(statSync(path).size).toBeGreaterThan(20_000);
  await testInfo.attach(name, { path, contentType: "image/png" });
};

const runPaletteCommand = async (page: Page, search: string, commandId: string) => {
  await page.keyboard.press("Control+K");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.getByPlaceholder("Run editor command...").fill(search);
  await page.getByTestId("command-palette").locator(`[data-command-id="${commandId}"]`).click();
};

test("sprints 18 to 20 expose undo, snapshots, large-world UX, and handoff", async ({ page }, testInfo) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("dirty-state-label")).toHaveText("SAVED");

  await runPaletteCommand(page, "unbreakable", "editor.area.createUnbreakableBox");
  await expect(page.getByTestId("protected-area-count")).toHaveText("4");
  await expect(page.getByTestId("current-selection-label")).toHaveText("Unbreakable Box 4");
  await captureVerifiedScreenshot(page, testInfo, "01-sprint18-undo-source");

  await page.locator('[data-command-id="editor.history.undo"]').first().click();
  await expect(page.getByTestId("protected-area-count")).toHaveText("3");
  await expect(page.getByTestId("command-history-latest-id")).toHaveText("editor.history.undo");

  await page.locator('[data-command-id="editor.history.redo"]').first().click();
  await expect(page.getByTestId("protected-area-count")).toHaveText("4");
  await captureVerifiedScreenshot(page, testInfo, "02-sprint18-redo-restored");

  await runPaletteCommand(page, "create editor snapshot", "editor.snapshot.create");
  await expect(page.getByTestId("command-history-latest-id")).toHaveText("editor.snapshot.create");

  const agentTab = page.locator(".dockview-react").getByText("Agent Workbench", { exact: true }).first();
  await agentTab.click();
  await expect(page.getByTestId("agent-section-history")).toContainText("Snapshots 1");
  await expect(page.getByTestId("agent-section-handoff")).toContainText("Frontend-only editor shell");
  await captureVerifiedScreenshot(page, testInfo, "03-sprint20-handoff");

  await page.locator('[data-command-id="editor.performance.loadLargeMockWorld"]').first().click();
  await expect(page.getByTestId("agent-section-large-world")).toContainText("large mock world");
  await expect(page.getByTestId("agent-section-large-world")).toContainText("4200 props");
  await expect(page.getByTestId("outliner-large-world-cap")).toBeVisible();

  const consoleTab = page.locator(".dockview-react").getByText("Console", { exact: true }).first();
  await consoleTab.click();
  await expect(page.getByTestId("console-large-world-cap")).toContainText("Showing newest 250 of 1200 entries.");
  await captureVerifiedScreenshot(page, testInfo, "04-sprint19-large-world-caps");
});
