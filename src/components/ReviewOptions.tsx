/**
 * The review's View options: one button beside the tree's filter, a menu of switches under it. Each row is a checkbox
 * item with its label, a dim line saying what it does, and the settings switch drawn at its end; a row that does not
 * apply where the review is (ignored files in Changed files) is left out, never disabled. A dot on the button says an
 * option shown differs from its default. A row toggles in place and the menu stays open for the next one.
 *
 * RowMenu does not fit: its items close the menu as they run and carry a check, not a description and a switch. This
 * menu stays inside the review's dialog (its focus trap holds Tab), drawn at fixed coordinates under the button, so the
 * tree column's edge does not cut it. Escape, a press outside, the focus leaving it or a resize close it; the focus then
 * goes back to the button.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { SlidersHorizontal } from "lucide-react";

import "./ReviewOptions.css";
import { useT } from "../lib/i18n.ts";

export interface ReviewOption {
  id: string;
  label: string;
  /** one dim line under the label: what the option does */
  description: string;
  checked: boolean;
  /** the state it starts in; a row away from it puts the dot on the button */
  byDefault: boolean;
  onChange: (checked: boolean) => void;
  /** the row's tooltip, when it has more to say (a worktree's path) */
  title?: string;
}

const GAP = 4;
const EDGE = 8;

export function ReviewOptions({ options }: { options: readonly ReviewOption[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const prefix = useId();
  // the last option gone closes the menu: it does not open again by itself when one comes back
  if (open && options.length === 0) setOpen(false);
  const shown = open && options.length > 0;
  const changed = options.some((option) => option.checked !== option.byDefault);
  // the rows by their ids: their states do not move the focus
  const ids = options.map((option) => option.id).join("\n");
  const first = options[0]?.id;
  const close = (): void => setOpen(false);

  // under the button, right edges lined up, above it when the screen ends first; placed before the first paint, and
  // again when a row comes or goes (its height changes with them)
  useLayoutEffect(() => {
    const node = menu.current, anchor = button.current;
    if (!shown || node === null || anchor === null) return;
    // measured at its full height: an earlier placement's limit would cut it
    node.style.maxHeight = "";
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(rect.right - node.offsetWidth, window.innerWidth - node.offsetWidth - EDGE));
    const below = rect.bottom + GAP;
    const roomBelow = window.innerHeight - below - EDGE;
    const roomAbove = rect.top - GAP - EDGE;
    const up = node.offsetHeight > roomBelow && roomAbove > roomBelow;
    const top = up ? Math.max(EDGE, rect.top - GAP - node.offsetHeight) : below;
    Object.assign(node.style, { top: `${top}px`, left: `${left}px`, maxHeight: `${Math.max(EDGE, up ? roomAbove : roomBelow)}px` });
  }, [shown, ids]);

  // the focus goes back to the button when the menu goes, and only then
  useLayoutEffect(() => {
    const anchor = button.current;
    if (!shown || anchor === null) return;
    return () => { if (anchor.isConnected) anchor.focus({ preventScroll: true }); };
  }, [shown]);

  // the focus in the menu: on the first row as it opens, and again when the row it was on no longer applies (a
  // worktree that moved on takes Show uncommitted changes with it)
  useLayoutEffect(() => {
    if (!shown) return;
    const active = document.activeElement;
    if (active !== null && menu.current?.contains(active) === true) return;
    if (first !== undefined) rows.current.get(first)?.focus({ preventScroll: true });
  }, [shown, ids, first]);

  useEffect(() => {
    if (!shown) return;
    const close = (): void => setOpen(false);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      // the menu's Escape, not the review's
      event.stopPropagation();
      event.preventDefault();
      close();
    };
    // the button's own click toggles the menu, so a press on it is not "outside"
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (menu.current?.contains(target) === true || button.current?.contains(target) === true) return;
      close();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("resize", close);
    };
  }, [shown]);

  if (options.length === 0) return null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const list = options.map((option) => rows.current.get(option.id)).filter((row) => row !== undefined);
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (next: number): void => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus({ preventScroll: true });
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(list.length - 1);
    // Tab leaves the menu, which then goes
    else if (event.key === "Tab") close();
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget as Node | null;
    if (next !== null && (menu.current?.contains(next) === true || button.current?.contains(next) === true)) return;
    close();
  };
  // Safari on a Mac does not focus a clicked button: the press keeps the focus on the row it is on, and the click still comes
  const keepFocus = (event: ReactMouseEvent<HTMLButtonElement>): void => event.preventDefault();

  return (
    <>
      <button ref={button} type="button" className="icon-button repo-diff-action review-options" aria-label={t("View options")} title={t("View options")}
        aria-haspopup="menu" aria-expanded={shown} aria-controls={shown ? `${prefix}menu` : undefined} onClick={() => setOpen(!shown)}>
        <SlidersHorizontal aria-hidden="true" />
        {changed && <span className="review-options-dot" aria-hidden="true" />}
      </button>
      {shown && <div ref={menu} id={`${prefix}menu`} className="menu review-options-menu" role="menu" aria-label={t("View options")} onKeyDown={onKeyDown} onBlur={onBlur}>
        {options.map((option) => (
          <button key={option.id} type="button" role="menuitemcheckbox" aria-checked={option.checked} tabIndex={-1} className="menu-item review-option" title={option.title}
            aria-labelledby={`${prefix}${option.id}-label`} aria-describedby={`${prefix}${option.id}-description`}
            ref={(node) => { if (node === null) rows.current.delete(option.id); else rows.current.set(option.id, node); }}
            onMouseDown={keepFocus} onClick={() => option.onChange(!option.checked)}>
            <span className="review-option-text">
              <span id={`${prefix}${option.id}-label`} className="review-option-label">{option.label}</span>
              <span id={`${prefix}${option.id}-description`} className="review-option-description">{option.description}</span>
            </span>
            <span className="review-option-switch" aria-hidden="true"><span className="review-option-thumb" /></span>
          </button>
        ))}
      </div>}
    </>
  );
}
