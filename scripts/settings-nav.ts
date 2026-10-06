/**
 * Settings shows one page at a time (src/components/SettingsDialog.tsx): the browser scripts
 * open the page a control lives on before they reach for it. The ids are the deep link's
 * (`#settings/<page>`, src/lib/settingsSearch.ts SETTINGS_PAGES).
 */
import type { Page } from "playwright-core";

export type SettingsPageId = "appearance" | "terminal" | "chat" | "voice" | "notifications" | "shortcuts" | "devices" | "remote-pcs" | "usage" | "about";

/** The open Settings dialog, in whatever language it is shown. */
export function settingsDialog(page: Page) {
  return page.locator('.settings-dialog[role="dialog"]');
}

/** Opens a page of the Settings dialog that is already open: its navigation item, on a desktop or in a phone's list. */
export async function settingsPage(page: Page, id: SettingsPageId): Promise<void> {
  const dialog = settingsDialog(page);
  await dialog.waitFor();
  // a phone shows the page, not the list, once a page is open: back to the list first
  const back = dialog.locator(".settings-back");
  if (await back.isVisible()) await back.click();
  await dialog.locator(`.settings-nav-item[data-page="${id}"]`).click();
  await dialog.locator(`.settings-page[data-page="${id}"]`).waitFor();
}

/** Opens Settings with its shortcut, on a page. */
export async function openSettingsPage(page: Page, id: SettingsPageId): Promise<void> {
  await page.keyboard.press("ControlOrMeta+Shift+Comma");
  await settingsPage(page, id);
}
