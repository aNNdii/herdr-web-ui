/**
 * The Settings dialog itself (src/components/SettingsDialog.tsx): its deep link, its fixed size,
 * the navigation, the search in English and in the language shown, Escape, the palette previews'
 * own tokens, quick replies' order, Add PC that never waits for the server's PC settings, and a
 * phone's list and pages.
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright-core";
import { settingsDialog, settingsPage } from "./settings-nav.ts";

const focusedName = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null);
const hash = (page: Page) => page.evaluate(() => window.location.hash);

export async function checkSettingsDialog(browser: Browser, origin: string): Promise<void> {
  const evidence = process.env.UI_EVIDENCE_DIR;
  if (evidence) mkdirSync(evidence, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  try {
    await context.addInitScript(() => {
      if (!localStorage.getItem("herdr-web-ui:settings")) localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en", palette: "catppuccin" }));
    });
    // the server's PC settings never answer: Add PC must not wait for them
    await context.route("**/api/machines/settings", () => undefined);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(10_000);

    // a link to a page opens Settings on it, with the search focused on a desktop
    await page.goto(`${origin}/#settings/terminal`);
    const dialog = settingsDialog(page);
    await dialog.waitFor();
    await dialog.getByRole("heading", { name: "Terminal", exact: true, level: 2 }).waitFor();
    assert.equal(await dialog.locator('.settings-nav-item[aria-current="page"]').getAttribute("data-page"), "terminal");
    await page.locator(".conn-live").waitFor({ state: "attached" });
    // the terminal behind it attaching does not take the focus from Settings
    await page.waitForTimeout(300);
    assert.equal(await focusedName(page), "Search settings", "the search has the focus");

    // one size for every page, the address follows, and the navigation's items never touch
    const size = await dialog.boundingBox();
    const gap = await page.evaluate(() => {
      const [first, second] = [...document.querySelectorAll(".settings-nav-item")].map((item) => item.getBoundingClientRect());
      return Math.round(second!.top - first!.bottom);
    });
    assert.equal(gap, 2, "2px between navigation items");
    for (const id of ["appearance", "chat", "voice", "notifications", "shortcuts", "devices", "remote-pcs", "usage", "about"] as const) {
      await settingsPage(page, id);
      assert.equal(await hash(page), `#settings/${id}`);
      assert.deepEqual(await dialog.boundingBox(), size, `${id} keeps the window's size`);
    }

    // Remote PCs: Add PC is there while the server's settings are still being asked
    await settingsPage(page, "remote-pcs");
    await dialog.getByRole("button", { name: "Add PC", exact: true }).waitFor();
    assert.equal(await dialog.getByRole("switch", { name: "Update PC bridges automatically", exact: true }).count(), 0, "the bridge switch waits for the server");

    // each palette tile carries its own palette's tokens, whatever the app's
    await settingsPage(page, "appearance");
    const canvas = (palette: string) => dialog.locator(`.palette-tile-preview[data-palette="${palette}"] .palette-tile-main`).evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(await canvas("amber"), "rgb(18, 16, 14)", "amber's own canvas inside a Catppuccin app");
    assert.equal(await canvas("report"), "rgb(10, 13, 18)");
    assert.equal(await canvas("catppuccin"), "rgb(30, 30, 46)");
    if (evidence) await page.screenshot({ path: join(evidence, "settings-appearance-desktop.png") });

    // quick replies move with their arrows
    await settingsPage(page, "chat");
    const replies = () => page.evaluate(() => (JSON.parse(localStorage.getItem("herdr-web-ui:settings") ?? "{}") as { quickReplies?: string[] }).quickReplies);
    await dialog.getByRole("button", { name: "Move quick reply 2 up", exact: true }).click();
    assert.deepEqual((await replies())?.slice(0, 2), ["yes", "continue"]);
    await dialog.getByRole("button", { name: "Restore defaults", exact: true }).click();
    assert.deepEqual((await replies())?.slice(0, 2), ["continue", "yes"]);

    // the search: "/" reaches it, every page answers, Escape clears it before it closes anything
    await dialog.getByRole("button", { name: "Restore defaults", exact: true }).focus();
    await page.keyboard.press("/");
    assert.equal(await focusedName(page), "Search settings", "/ moves to the search");
    await page.keyboard.type("font");
    await dialog.getByRole("heading", { name: "Search results", exact: true }).waitFor();
    assert.deepEqual(await dialog.locator(".settings-page-heading:visible").allTextContents(), ["Terminal", "Chat"]);
    assert.equal(await dialog.locator(".settings-row:visible").count(), 4, "font size and font, for the terminal and the chat");
    // a control works in the results
    await dialog.getByRole("button", { name: "Increase terminal font size", exact: true }).click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("herdr-web-ui:settings") ?? "{}").terminalFontSize), 14);
    await dialog.getByRole("button", { name: "Decrease terminal font size", exact: true }).click();
    if (evidence) await page.screenshot({ path: join(evidence, "settings-search-desktop.png") });
    await page.locator(".settings-search input").fill("no such setting anywhere");
    await dialog.getByText("No settings match “no such setting anywhere”.", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".settings-search input").inputValue(), "", "the first Escape clears the search");
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await hash(page), "", "closing takes the page out of the address");

    // the language shown and English both find a row
    await page.evaluate(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ ...JSON.parse(localStorage.getItem("herdr-web-ui:settings") ?? "{}"), language: "ko" })));
    // a reload keeps the link: Settings opens again, in Korean
    await page.evaluate(() => { window.history.replaceState(null, "", "/#settings/appearance"); });
    await page.reload();
    const korean = page.getByRole("dialog", { name: "설정", exact: true });
    await korean.waitFor();
    await page.locator(".settings-search input").fill("소리");
    await korean.getByRole("switch", { name: "소리", exact: true }).waitFor();
    await page.locator(".settings-search input").fill("sound");
    await korean.getByRole("switch", { name: "소리", exact: true }).waitFor();
    await page.evaluate(() => localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ ...JSON.parse(localStorage.getItem("herdr-web-ui:settings") ?? "{}"), language: "en" })));
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }

  // a phone: the whole screen, the list of pages with what they are set to, then a page
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "en-US" });
  try {
    await phone.addInitScript(() => {
      if (!localStorage.getItem("herdr-web-ui:settings")) localStorage.setItem("herdr-web-ui:settings", JSON.stringify({ language: "en" }));
    });
    const page = await phone.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/#settings`);
    const dialog = settingsDialog(page);
    await dialog.waitFor();
    assert.notEqual(await focusedName(page), "Search settings", "no keyboard pops up on a touch screen");
    const box = await dialog.boundingBox();
    assert.ok(box && box.x === 0 && box.y === 0 && box.width === 390 && box.height === 844, "full screen");
    const appearance = dialog.locator('.settings-nav-item[data-page="appearance"]');
    assert.equal(await appearance.locator(".settings-nav-summary").textContent(), "Dark · Amber · Comfortable");
    if (evidence) await page.screenshot({ path: join(evidence, "settings-list-phone.png") });
    await dialog.locator('.settings-nav-item[data-page="notifications"]').click();
    assert.equal(await hash(page), "#settings/notifications");
    await dialog.getByRole("heading", { name: "Notifications", exact: true, level: 2 }).waitFor();
    // the choices take the row's width
    const segmented = await dialog.getByRole("group", { name: "An agent finishes", exact: true }).boundingBox();
    assert.ok(segmented && segmented.width > 300, "a segmented control is full width on a phone");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (evidence) await page.screenshot({ path: join(evidence, "settings-notifications-phone.png") });
    await dialog.getByRole("button", { name: "All settings", exact: true }).click();
    assert.equal(await hash(page), "#settings");
    await page.locator(".settings-search input").fill("sound");
    await dialog.getByRole("switch", { name: "Sound", exact: true }).waitFor();
    assert.equal(await page.locator(".settings-search input").isVisible(), true, "the search stays above its results");
    await dialog.getByRole("button", { name: "Close settings", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
  } finally {
    await phone.close();
  }
  console.log("PASS Settings: deep link, fixed size, navigation, palette previews, quick reply order, search (English and the language shown), Escape, Add PC without the server's settings, phone list and pages");
}

if (import.meta.main) {
  await import("./test-herdr.ts");
  const { createServer } = await import("../server/index.ts");
  const { workspaceCreate, workspaceClose } = await import("../server/herdr/client.ts");
  const { UsageService } = await import("../server/usage.ts");
  const { chromium } = await import("playwright-core");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const root = mkdtempSync(join(tmpdir(), "herdr-settings-qa-"));
  const server = createServer({ port: 0, hostname: "127.0.0.1", stateDir: root, token: "", usage: new UsageService(undefined, []) });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome", headless: true, args: ["--no-sandbox", "--accept-lang=en-US"] });
  let workspace: string | null = null;
  try {
    // a pane of its own, so the app behind Settings has a terminal that attaches
    workspace = (await workspaceCreate({ cwd: root, label: "herdr-web-ui-test-settings" })).workspace.workspace_id;
    await checkSettingsDialog(browser, `http://127.0.0.1:${server.port}`);
  } finally {
    await browser.close(); server.stop();
    if (workspace) await workspaceClose(workspace);
    rmSync(root, { recursive: true, force: true });
  }
}
