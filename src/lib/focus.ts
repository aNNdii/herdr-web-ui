/**
 * Where focus goes when the control that had it is gone: Add PC closed Settings behind it, a
 * closed row left the roster. The header's workspace-list toggle is the control nearest the PC
 * list, and one of the two is always shown: the drawer's on a phone, the sidebar's on a desktop.
 * Runs a frame later, once React has taken the vanished control out of the document.
 */
export function focusWorkspaceListToggle(): void {
  window.requestAnimationFrame(() => {
    const toggles = document.querySelectorAll<HTMLElement>(".app-header .drawer-toggle, .app-header .sidebar-toggle");
    [...toggles].find((toggle) => toggle.getClientRects().length > 0)?.focus();
  });
}

/**
 * Whether a modal surface is up (Settings, a dialog). A pane that appears under one, as a link
 * that opens Settings mounts it beneath the dialog (lib/deepLink.ts), must not take the focus out
 * of the modal: its composer and its grid leave the keyboard where it is.
 */
export function modalOpen(): boolean {
  return document.querySelector("[aria-modal='true'], dialog[open]") !== null;
}

/**
 * The element that has the focus, followed into a same-origin frame that holds it (the frame itself where its document
 * cannot be read). Needs only `localName`, `contentDocument` and `activeElement`, so a stand-in object tests it.
 */
export function deepActiveElement(doc: { activeElement: Element | null }): Element | null {
  let active = doc.activeElement;
  for (let depth = 0; active !== null && active.localName === "iframe" && depth < 8; depth += 1) {
    let inner: Element | null | undefined;
    try {
      inner = (active as HTMLIFrameElement).contentDocument?.activeElement;
    } catch {
      return active;
    }
    if (inner === null || inner === undefined) return active;
    active = inner;
  }
  return active;
}

const NOT_TYPED = new Set(["button", "checkbox", "radio", "range", "submit", "reset", "file", "color"]);

/**
 * Whether `element` takes typed text (a soft keyboard rises for it): a textarea (xterm's helper only in direct typing), a
 * text input, an editable element. By name, not `instanceof`: a field in a frame is an element of another realm.
 */
export function isTypingField(element: Element | null): boolean {
  if (element === null) return false;
  if (element.localName === "textarea") return !element.classList.contains("xterm-helper-textarea") || element.closest("[data-direct-typing]") !== null;
  if (element.localName === "input") return !NOT_TYPED.has((element as HTMLInputElement).type);
  return (element as HTMLElement).isContentEditable === true;
}
