/**
 * The comment mode's toggle (Settings `commentMode`, one mode for the whole app), as the file viewer's header and the
 * chat (beside Find) show it: `MessageSquareText`, pressed while the mode is on (the glyph in the accent), with the count
 * of the comments it covers as a badge on its corner (the full text, outdated ones included, is its name and tooltip:
 * "Comment mode, {count}"). Turned by a finger, it shows the host's hint (`showHint`): how to comment there now
 * (`hintOn`), or that the mode is off. Each press says what pressed it; a keyboard's click (detail 0) is a mouse's.
 * Where it sits is the host's (`className`); a host that shows it while comments are off would show a dead control, so
 * the hosts show it only with Settings → Comments on.
 */
import { useRef, type ReactElement, type Ref } from "react";
import { MessageSquareText } from "lucide-react";

import "./CommentModeToggle.css";

import { useT } from "../lib/i18n.ts";
import { useSettings } from "../lib/settings.ts";
import type { ModeHint } from "./CommentModeHint.tsx";

export function CommentModeToggle({ count, outdated = 0, className, buttonRef, hintOn, showHint }: {
  /** the comments it covers (the file's, the pane's replies') */
  count: number;
  /** how many of them are outdated, named after the count */
  outdated?: number;
  /** the host's classes, which place it */
  className: string;
  buttonRef?: Ref<HTMLButtonElement>;
  /** the hint a finger turning the mode on gets */
  hintOn: ModeHint;
  showHint: (hint: ModeHint) => void;
}): ReactElement {
  const t = useT();
  const { settings, update } = useSettings();
  const pressedBy = useRef("mouse");
  const counted = t(count === 1 ? "{count} comment" : "{count} comments", { count });
  const countLabel = outdated > 0 ? `${counted} · ${t("{count} outdated", { count: outdated })}` : counted;
  const label = count > 0 ? t("Comment mode, {count}", { count: countLabel }) : t("Comment mode");
  const toggle = (pointerType: string): void => {
    const on = !settings.commentMode;
    update({ commentMode: on });
    if (pointerType === "touch") showHint(on ? hintOn : "off");
  };
  return <button ref={buttonRef} type="button" className={`icon-button comment-mode-toggle ${className}`} aria-pressed={settings.commentMode} aria-label={label} title={label}
    onPointerDown={(event) => { pressedBy.current = event.pointerType; }}
    onClick={(event) => { toggle(event.detail === 0 ? "mouse" : pressedBy.current); pressedBy.current = "mouse"; }}>
    <MessageSquareText aria-hidden="true" />
    {count > 0 && <span className="comment-mode-count" aria-hidden="true">{count > 99 ? "99+" : count}</span>}
  </button>;
}
