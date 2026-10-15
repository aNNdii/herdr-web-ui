/**
 * The hint shown as the comment mode is turned by touch (CommentModeToggle.tsx), on every surface that has the mode: the
 * file viewer's code view and preview (FileViewer.tsx) and the chat (ChatView.tsx). It says how to comment once the mode
 * is on, or that it is off, for `HINT_MS`, in a live region at the top of the surface's view.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import "./CommentModeHint.css";

import { useT } from "../lib/i18n.ts";

/** How long the hint shows. */
export const HINT_MS = 2600;

/**
 * What the hint says: how to comment once the mode is on (in the code view by the gesture set; in the Markdown preview
 * and the chat, `select`, by selecting text), or that it is off.
 */
export type ModeHint = "hold" | "tap" | "select" | "off";

/** The hint shown as the mode is turned by touch, for `HINT_MS`: `show` starts it again with each turn. */
export function useModeHint(): { hint: ModeHint | null; show: (hint: ModeHint) => void } {
  const [hint, setHint] = useState<ModeHint | null>(null);
  const timer = useRef(0);
  const show = useCallback((next: ModeHint): void => {
    window.clearTimeout(timer.current);
    setHint(next);
    timer.current = window.setTimeout(() => setHint(null), HINT_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { hint, show };
}

/**
 * The hint, in the surface (the viewer's body, the chat's frame): a live region (always there, so a screen reader hears
 * each hint) kept at the top of the surface's view, under the viewer's header, as it scrolls. It takes no tap: the text
 * or code under it stays pressable. Its class names (`.code-comment-status`, `.code-comment-hint`) are the ones the
 * browser scripts read.
 */
export const CommentModeHint = memo(function CommentModeHint({ surface, hint }: { surface: RefObject<HTMLDivElement | null>; hint: ModeHint | null }) {
  const t = useT();
  const region = useRef<HTMLDivElement>(null);
  const shown = hint !== null;
  useLayoutEffect(() => {
    const body = surface.current;
    const node = region.current;
    if (!shown || body === null || node === null) return;
    const follow = (): void => { node.style.top = `${body.scrollTop}px`; };
    follow();
    body.addEventListener("scroll", follow, { passive: true });
    return () => body.removeEventListener("scroll", follow);
  }, [shown, surface]);
  const text = hint === "hold" ? t("Press and hold a line to comment") : hint === "tap" ? t("Tap a line to comment")
    : hint === "select" ? t("Select text to comment") : hint === "off" ? t("Comment mode off") : null;
  return <div ref={region} className="code-comment-status" role="status">
    {text !== null && <p key={hint} className="code-comment-hint">{text}</p>}
  </div>;
});
