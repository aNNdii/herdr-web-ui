/**
 * Whether this page is in use: on screen and holding the focus, the same test PaneTerminal's
 * `inUse` makes. Every PC connection tells its server (WS `presence`), and while any page is in
 * use the server sends no web push to any device (#751).
 */
export function pageInUse(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();
}

/**
 * Calls `left` when the user leaves the page's window (another app or window takes the focus) and `back` when the
 * window has the focus again. Returns the unsubscribe. Every window `blur`/`focus` listener that means "the user left or
 * came back" goes through here, because of the page's own frames:
 *
 * - The page's window blurs also as the focus goes into a same-origin frame of the page (the code view's comment field,
 *   components/FrameField.tsx), and the user has not left then. So a `blur` counts as leaving only if, one tick later,
 *   once the focus has landed, `document.hasFocus()` is false.
 * - While the focus is in such a frame, the page's window hears nothing more: leaving the app goes to the frame's window
 *   as its `blur`, coming back into the frame as its `focus`. So the focus is followed into the frame: its window's `blur`
 *   gets the same deferred check, and its `focus` is `back`. Those listeners go as the focus leaves the frame (the page
 *   has it again, or another element), as the frame goes (its window's `pagehide`), and with the unsubscribe.
 *
 * The focus moving between the page and its own frame, with the window never left, is neither: no `left`, and no `back`
 * (a terminal would refit and resize its pty on each `back`, so closing a comment field must not count as a return).
 */
export function watchWindowPresence(left: () => void, back: () => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  let check: ReturnType<typeof setTimeout> | undefined;
  /** `left` reported and no `back` since */
  let away = false;
  const leave = (): void => {
    away = true;
    left();
  };
  const returned = (): void => {
    away = false;
    back();
  };
  /** the frame window the focus was followed into, and how to stop listening there */
  let followed: { view: Window; stop: () => void } | null = null;

  const unfollow = (): void => {
    followed?.stop();
    followed = null;
  };
  /** Listens on the window of the page's frame that has the focus, if one has it (and only that one). */
  const follow = (): void => {
    const active = document.activeElement;
    let view: Window | null = null;
    if (active !== null && active.localName === "iframe") {
      try {
        // a frame of another origin has no document to read: the page cannot listen on its window
        const frame = active as HTMLIFrameElement;
        if (frame.contentDocument !== null) view = frame.contentWindow;
      } catch {
        view = null;
      }
    }
    if (followed !== null && followed.view === view) return;
    unfollow();
    if (view === null) return;
    const frameView = view;
    frameView.addEventListener("blur", onBlur);
    frameView.addEventListener("focus", returned);
    frameView.addEventListener("pagehide", unfollow);
    followed = {
      view: frameView,
      stop: () => {
        frameView.removeEventListener("blur", onBlur);
        frameView.removeEventListener("focus", returned);
        frameView.removeEventListener("pagehide", unfollow);
      },
    };
  };
  function onBlur(): void {
    clearTimeout(check);
    check = setTimeout(() => {
      if (!document.hasFocus()) leave();
      follow();
    }, 0);
  }
  const onFocus = (): void => {
    // the page's own document has the focus: none of its frames does. Straight from its frame, the window never left
    const fromFrame = followed !== null && !away;
    unfollow();
    if (!fromFrame) returned();
  };

  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  // subscribed while the focus is in a frame already
  follow();
  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    clearTimeout(check);
    unfollow();
  };
}

/** Calls `listener` with `pageInUse()` now and again whenever focus or visibility changes. */
export function watchPageInUse(listener: (active: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  const update = (): void => listener(pageInUse());
  update();
  const stopFocus = watchWindowPresence(update, update);
  window.addEventListener("pagehide", update);
  document.addEventListener("visibilitychange", update);
  return () => {
    stopFocus();
    window.removeEventListener("pagehide", update);
    document.removeEventListener("visibilitychange", update);
  };
}
