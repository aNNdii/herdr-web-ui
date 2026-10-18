import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import "./BranchCombobox.css";

import { filterBranches, type BranchChoice } from "../lib/branchReview.ts";
import { comboboxEnter, comboboxStep, type ComboboxEvent, type ComboboxState } from "../lib/combobox.ts";
import { useT } from "../lib/i18n.ts";

export interface BranchComboboxProps {
  label: string;
  /** the name the field holds, as chosen or typed */
  value: string;
  /** null: no list (still loading, failed, or an older bridge), the field takes free text only */
  branches: readonly BranchChoice[] | null;
  /** the server left remote branches out */
  truncated: boolean;
  hint: { text: string; alert: boolean } | null;
  placeholder?: string;
  /** a branch from the list, or the text as typed on Enter */
  onChoose: (name: string) => void;
}

/** room kept between the list and the field, and the visible area's edge */
const GAP = 4;
const EDGE = 8;
const MAX_HEIGHT = 320;
/** below this much room under the field, the list opens above it when there is more there */
const MIN_BELOW = 160;

/**
 * Where the list goes: fixed under the field (above it when the room below is short), inside
 * the visual viewport, so a soft keyboard that covers the page's bottom does not cover the list.
 */
function listPlace(field: DOMRect): CSSProperties {
  const viewport = window.visualViewport;
  const top = viewport === null ? 0 : viewport.offsetTop;
  const bottom = viewport === null ? window.innerHeight : viewport.offsetTop + viewport.height;
  const below = bottom - field.bottom - GAP - EDGE;
  const above = field.top - top - GAP - EDGE;
  const up = below < MIN_BELOW && above > below;
  return {
    left: field.left,
    width: field.width,
    maxHeight: Math.max(0, Math.min(MAX_HEIGHT, up ? above : below)),
    ...(up ? { bottom: window.innerHeight - field.top + GAP } : { top: field.bottom + GAP }),
  };
}

/**
 * A text field that offers the repository's branches: typing filters them, the arrow keys move
 * through them, Enter takes the active one or the text as typed (a tag, a SHA, `HEAD~3`), and
 * Escape closes only the list. Local branches come first, then remote ones; a branch checked out
 * in a worktree names its folder, with the full path as its tooltip.
 */
export function BranchCombobox({ label, value, branches, truncated, hint, placeholder, onChoose }: BranchComboboxProps) {
  const t = useT();
  const id = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ComboboxState>({ open: false });
  const [place, setPlace] = useState<CSSProperties>({});

  const query = state.open ? state.query : null;
  // local branches first, then remote ones: `active` indexes this order
  const { local, remote } = useMemo(() => {
    const matching = branches === null ? [] : filterBranches(branches, query ?? "");
    return { local: matching.filter((option) => !option.remote), remote: matching.filter((option) => option.remote) };
  }, [branches, query]);
  const names = useMemo(() => [...local, ...remote].map((option) => option.name), [local, remote]);
  const shown = state.open && names.length > 0;
  const active = state.open ? state.active : null;
  const optionId = (index: number): string => `${id}-option-${index}`;

  const step = (event: ComboboxEvent): void => setState((current) => comboboxStep(current, event, names.length));

  // the list follows its field while the page, the sheet or the soft keyboard moves it
  useEffect(() => {
    if (!shown) return;
    const follow = (event?: Event): void => {
      if (event?.target instanceof Node && listRef.current?.contains(event.target)) return;
      const field = fieldRef.current;
      if (field !== null) setPlace(listPlace(field.getBoundingClientRect()));
    };
    follow();
    const viewport = window.visualViewport;
    document.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    viewport?.addEventListener("resize", follow);
    viewport?.addEventListener("scroll", follow);
    return () => {
      document.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
      viewport?.removeEventListener("resize", follow);
      viewport?.removeEventListener("scroll", follow);
    };
  }, [shown]);

  // the active option in view: only the list scrolls, never the dialog under it
  useEffect(() => {
    const list = listRef.current;
    const option = active === null ? null : document.getElementById(`${id}-option-${active}`);
    if (list === null || option === null) return;
    const optionBounds = option.getBoundingClientRect();
    const listBounds = list.getBoundingClientRect();
    if (optionBounds.top < listBounds.top) list.scrollTop -= listBounds.top - optionBounds.top;
    else if (optionBounds.bottom > listBounds.bottom) list.scrollTop += optionBounds.bottom - listBounds.bottom;
  }, [id, active, shown]);

  const choose = (name: string): void => {
    setState({ open: false });
    onChoose(name);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (event.altKey) step(event.key === "ArrowDown" ? { type: "open" } : { type: "close" });
      else step({ type: "move", by: event.key === "ArrowDown" ? 1 : -1 });
    } else if ((event.key === "Home" || event.key === "End") && active !== null) {
      // with an option active the keys move in the list; otherwise they move the caret
      event.preventDefault();
      step({ type: "move", by: event.key === "Home" ? "first" : "last" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      const name = comboboxEnter(state, names);
      if (name !== null) choose(name);
      else step({ type: "close" });
    } else if (event.key === "Escape" && state.open) {
      // close the list only, not the dialog around it
      event.preventDefault();
      event.stopPropagation();
      step({ type: "close" });
    } else if (event.key === "Tab") {
      step({ type: "close" });
    }
  };

  const optionRow = (option: BranchChoice, index: number): ReactNode => {
    const worktree = option.worktree;
    return (
      <div
        key={option.name}
        id={optionId(index)}
        className="menu-item"
        role="option"
        aria-selected={option.name === value}
        data-active={index === active || undefined}
        onPointerEnter={() => step({ type: "hover", index })}
        // keep the focus in the field, so the tap does not blur it before the click
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(option.name)}
      >
        <span className="menu-item-main">{option.name}</span>
        {worktree !== null && <span className="menu-item-hint branch-combobox-worktree" title={worktree.path}>{worktree.here ? t("this worktree") : worktree.name}</span>}
      </div>
    );
  };

  const group = (heading: string, rows: readonly BranchChoice[], key: string, first: number): ReactNode => rows.length === 0 ? null : (
    <div role="group" aria-labelledby={`${id}-${key}`}>
      <div id={`${id}-${key}`} className="menu-heading" role="presentation">{heading}</div>
      {rows.map((option, index) => optionRow(option, first + index))}
    </div>
  );

  return (
    <div className="field branch-combobox">
      <label className="field-label" htmlFor={`${id}-field`}>{label}</label>
      <input
        ref={fieldRef}
        id={`${id}-field`}
        className="input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={`${id}-list`}
        aria-activedescendant={shown && active !== null ? optionId(active) : undefined}
        aria-invalid={hint?.alert === true || undefined}
        aria-describedby={hint === null ? undefined : `${id}-hint`}
        value={query ?? value}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="go"
        onChange={(event) => step({ type: "input", text: event.target.value })}
        onFocus={(event) => event.target.select()}
        onClick={() => step({ type: "open" })}
        onBlur={() => step({ type: "close" })}
        onKeyDown={onKeyDown}
      />
      {hint !== null && <span id={`${id}-hint`} className={hint.alert ? "field-hint branch-combobox-error" : "field-hint"} role={hint.alert ? "alert" : undefined}>{hint.text}</span>}
      <div className="menu branch-combobox-menu" hidden={!shown} style={place}>
        <div ref={listRef} id={`${id}-list`} className="branch-combobox-list" role="listbox" aria-label={label}>
          {shown && group(t("Local"), local, "local", 0)}
          {shown && group(t("Remote"), remote, "remote", local.length)}
        </div>
        {shown && truncated && <div className="branch-combobox-note">{t("Only the newest remote branches are listed. Type a name to use another.")}</div>}
      </div>
    </div>
  );
}
