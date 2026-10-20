/**
 * What the review compares, as the line under its title: "Uncommitted changes ⌄" or "Staged changes ⌄", and under
 * Branches "⑂ compare ⌄ vs ⑂ base ⌄". Each part opens its picker right under itself, as Zed's branch and project
 * pickers do: one popover that holds a search field and the list (no second overlay), at fixed coordinates placed
 * before the first paint, so the review's scroll boxes do not cut it and it does not jump. On a phone it is a bottom
 * sheet over its own scrim, as the More menu's is; Back and a swipe down close it there.
 *
 * Compare's picker has Uncommitted | Staged | Branches on top; Base's has the branch list alone. The list holds local
 * branches, then remote ones: the chosen one checked, a branch checked out in a worktree named by its folder, and its
 * tip commit as `hash · age · subject` where the bridge names it. Typing filters it, the arrow keys move in it
 * (lib/combobox.ts), Enter takes the active branch or the text as typed (a tag, a commit), Escape closes the picker
 * and gives the focus back to its part. A press outside or the focus leaving closes it too.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Check, ChevronDown, GitBranch } from "lucide-react";

import "./ComparePicker.css";
import { filterBranches, type BranchChoice } from "../lib/branchReview.ts";
import { comboboxEnter, comboboxStep, type ComboboxEvent, type ComboboxState } from "../lib/combobox.ts";
import { commitAge } from "../lib/commitAge.ts";
import { useLocale, useT } from "../lib/i18n.ts";
import { SHEET_QUERY, useSheetSwipe } from "../lib/sheets.ts";
import { useSheetHistory } from "../lib/sheetHistory.ts";
import { useMediaQuery } from "../lib/useMediaQuery.ts";

export type CompareMode = "uncommitted" | "staged" | "branches";
type Tip = Exclude<CompareMode, "branches">;
type Part = "compare" | "base";

export interface ComparePickerProps {
  /** what is compared now */
  mode: CompareMode;
  /** the branch names compared under Branches, as chosen or by default */
  compare: string;
  base: string;
  /** null: no list (still loading, failed, or an older bridge); a name is typed then */
  branches: readonly BranchChoice[] | null;
  /** the list is on its way */
  listLoading: boolean;
  /** the server left remote branches out */
  truncated: boolean;
  /** the part a refused comparison belongs to: marked invalid, described by `errorId` */
  invalid: Part | null;
  errorId?: string;
  onTip: (tip: Tip) => void;
  /** a branch from the list, or a name as typed, for compare or base: Branches from then on */
  onBranch: (part: Part, name: string) => void;
  /** Compare's or Base's picker opens: the review reads the branch list now if it has not yet, so Branches has it ready */
  onBranchesShown: () => void;
}

/** room kept between the picker and its part, and the visible area's edge */
const GAP = 4;
const EDGE = 8;
const MAX_HEIGHT = 420;
/** below this much room under the part, the picker opens above it when there is more there */
const MIN_BELOW = 200;
const SEARCHING: ComboboxState = { open: true, query: null, active: null };

/**
 * Under the part, its left edges lined up and kept on the screen, inside the visual viewport (a soft keyboard covers
 * the page's bottom); above it when the room below is short and there is more above.
 */
function placeUnder(node: HTMLElement, part: DOMRect): void {
  const viewport = window.visualViewport;
  const top = viewport === null ? 0 : viewport.offsetTop;
  const bottom = viewport === null ? window.innerHeight : viewport.offsetTop + viewport.height;
  const below = bottom - part.bottom - GAP - EDGE;
  const above = part.top - top - GAP - EDGE;
  const up = below < MIN_BELOW && above > below;
  Object.assign(node.style, {
    left: `${Math.max(EDGE, Math.min(part.left, window.innerWidth - node.offsetWidth - EDGE))}px`,
    maxHeight: `${Math.max(0, Math.min(MAX_HEIGHT, up ? above : below))}px`,
    top: up ? "" : `${part.bottom + GAP}px`,
    bottom: up ? `${window.innerHeight - part.top + GAP}px` : "",
  });
}

export function ComparePicker({ mode, compare, base, branches, listLoading, truncated, invalid, errorId, onTip, onBranch, onBranchesShown }: ComparePickerProps) {
  const t = useT();
  const locale = useLocale();
  const id = useId();
  const sheet = useMediaQuery(SHEET_QUERY);
  const [open, setOpen] = useState<Part | null>(null);
  // the tab Compare's picker shows; Base's is always the list
  const [tab, setTab] = useState<CompareMode>(mode);
  const [search, setSearch] = useState<ComboboxState>(SEARCHING);
  // when the picker opened: the commits' ages count from it, so a render (a key, a hover) says the same and stays pure
  const [openedAt, setOpenedAt] = useState(0);
  const parts = useRef<Record<Part, HTMLButtonElement | null>>({ compare: null, base: null });
  const surface = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const tipRow = useRef<HTMLButtonElement>(null);
  // the part the focus goes back to as the picker closes: its own after Escape or a choice, none after a press elsewhere
  const returnTo = useRef<Part | null>(null);

  // Base leaves with Branches, and its picker with it
  if (open === "base" && mode !== "branches") setOpen(null);
  const listShown = open === "base" || (open === "compare" && tab === "branches");
  const query = search.open ? search.query : null;
  const active = search.open ? search.active : null;
  // local branches first, then remote ones: `active` indexes this order
  const { local, remote } = useMemo(() => {
    const matching = branches === null ? [] : filterBranches(branches, query ?? "");
    return { local: matching.filter((one) => !one.remote), remote: matching.filter((one) => one.remote) };
  }, [branches, query]);
  const names = useMemo(() => [...local, ...remote].map((one) => one.name), [local, remote]);
  // each branch's `hash · age · subject`, once per list and opening: the rows render again on every key and hover
  const details = useMemo(() => {
    const found = new Map<string, string>();
    if (branches === null || openedAt === 0) return found;
    for (const { name, commit } of branches) {
      if (commit === null) continue;
      found.set(name, [commit.hash.slice(0, 7), commitAge(locale, commit.time, openedAt), commit.subject].filter((part) => part !== "").join(" · "));
    }
    return found;
  }, [branches, locale, openedAt]);
  const chosen = open === "base" ? base.trim() : mode === "branches" ? compare.trim() : null;
  const optionId = (index: number): string => `${id}-option-${index}`;
  const label = open === "base" ? t("Base") : t("Compare");

  const close = (back: boolean): void => {
    returnTo.current = back ? open : null;
    setOpen(null);
  };
  const show = (part: Part, next: CompareMode): void => {
    setOpen(part);
    setTab(next);
    setSearch(SEARCHING);
    setOpenedAt(Date.now());
    onBranchesShown();
  };
  const toggle = (part: Part): void => {
    if (open === part) close(true);
    else show(part, part === "compare" ? mode : "branches");
  };
  const chooseBranch = (name: string): void => {
    if (open === null) return;
    const part = open;
    close(true);
    onBranch(part, name);
  };
  const chooseTip = (tip: Tip): void => {
    close(true);
    onTip(tip);
  };
  const step = (event: ComboboxEvent): void => setSearch((current) => comboboxStep(current, event, names.length));

  // placed under its part before the first paint, and again as the page, the dialog or the soft keyboard moves it; a
  // phone's sheet is placed by its scrim
  useLayoutEffect(() => {
    if (open === null || sheet) return;
    const follow = (event?: Event): void => {
      // the list's own scroll leaves the picker where it is
      if (event !== undefined && surface.current?.contains(event.target as Node | null) === true) return;
      const node = surface.current, part = parts.current[open];
      if (node !== null && part !== null) placeUnder(node, part.getBoundingClientRect());
    };
    follow();
    const viewport = window.visualViewport;
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    viewport?.addEventListener("resize", follow);
    viewport?.addEventListener("scroll", follow);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
      viewport?.removeEventListener("resize", follow);
      viewport?.removeEventListener("scroll", follow);
    };
  }, [open, sheet]);

  // the focus: into the picker as it opens (the search field, or the tip's row), back to the part as it closes
  useLayoutEffect(() => {
    if (open === null) {
      const part = returnTo.current;
      returnTo.current = null;
      if (part !== null) parts.current[part]?.focus({ preventScroll: true });
      return;
    }
    if (listShown) field.current?.focus({ preventScroll: true });
    else tipRow.current?.focus({ preventScroll: true });
  }, [open, listShown, tab]);

  // Escape is the picker's, not the review's; a press outside it and its parts closes it
  useEffect(() => {
    if (open === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      returnTo.current = open;
      setOpen(null);
    };
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (surface.current?.contains(target) === true || Object.values(parts.current).some((part) => part?.contains(target) === true)) return;
      returnTo.current = null;
      setOpen(null);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open]);

  // the active option in view before the paint: only the list scrolls, never the dialog under it
  useLayoutEffect(() => {
    const box = list.current;
    const option = active === null ? null : document.getElementById(`${id}-option-${active}`);
    if (box === null || option === null) return;
    const optionBounds = option.getBoundingClientRect();
    const listBounds = box.getBoundingClientRect();
    if (optionBounds.top < listBounds.top) box.scrollTop -= listBounds.top - optionBounds.top;
    else if (optionBounds.bottom > listBounds.bottom) box.scrollTop += optionBounds.bottom - listBounds.bottom;
  }, [id, active, listShown]);

  // a phone's sheet: Back and a swipe down close it, as the More menu's
  useSheetHistory(sheet && open !== null, () => close(true));
  useSheetSwipe(surface, sheet && open !== null ? () => close(true) : null);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      step({ type: "move", by: event.key === "ArrowDown" ? 1 : -1 });
    } else if ((event.key === "Home" || event.key === "End") && active !== null) {
      // with an option active the keys move in the list; otherwise they move the caret
      event.preventDefault();
      step({ type: "move", by: event.key === "Home" ? "first" : "last" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      const name = comboboxEnter(search, names);
      if (name !== null && name.trim() !== "") chooseBranch(name.trim());
    }
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget as Node | null;
    if (next !== null && (surface.current?.contains(next) === true || Object.values(parts.current).some((part) => part?.contains(next) === true))) return;
    close(false);
  };
  // a press in the picker keeps the focus where it is (the search field, a row): Safari on a Mac focuses no clicked
  // button, and a press on a heading would blur the field with nowhere to go, either closing the picker before the click
  const keepFocus = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.target !== field.current) event.preventDefault();
  };

  const partButton = (part: Part, content: ReactNode): ReactNode => (
    <button
      ref={(node) => { parts.current[part] = node; }}
      type="button"
      className={mode === "branches" ? "compare-part is-branch" : "compare-part"}
      data-part={part}
      aria-haspopup="dialog"
      aria-expanded={open === part}
      aria-controls={open === part ? `${id}-picker` : undefined}
      aria-invalid={invalid === part || (part === "base" && base.trim() === "") || undefined}
      aria-describedby={invalid === part ? errorId : undefined}
      onClick={() => toggle(part)}
    >
      {content}
      <ChevronDown className="compare-part-chevron" aria-hidden="true" />
    </button>
  );

  const option = (branch: BranchChoice, index: number): ReactNode => {
    const { worktree } = branch;
    const meta = details.get(branch.name) ?? "";
    return (
      <div
        key={branch.name}
        id={optionId(index)}
        className="menu-item compare-picker-option"
        role="option"
        aria-selected={branch.name === chosen}
        data-active={index === active || undefined}
        onPointerEnter={() => step({ type: "hover", index })}
        onClick={() => chooseBranch(branch.name)}
      >
        <span className="compare-picker-mark">{branch.name === chosen && <Check aria-hidden="true" />}</span>
        <span className="compare-picker-text">
          <span className="compare-picker-name">{branch.name}</span>
          {(worktree !== null || meta !== "") && <span className="compare-picker-meta">
            {worktree !== null && <span className="compare-picker-worktree" title={worktree.path}>{worktree.here ? t("this worktree") : worktree.name}</span>}
            {meta !== "" && `${worktree !== null ? " · " : ""}${meta}`}
          </span>}
        </span>
      </div>
    );
  };
  const group = (heading: string, rows: readonly BranchChoice[], key: string, first: number): ReactNode => rows.length === 0 ? null : (
    <div role="group" aria-labelledby={`${id}-${key}`}>
      <div id={`${id}-${key}`} className="menu-heading" role="presentation">{heading}</div>
      {rows.map((branch, index) => option(branch, first + index))}
    </div>
  );

  const tipShown: Tip = tab === "staged" ? "staged" : "uncommitted";
  const picker = open === null ? null : (
    <div ref={surface} id={`${id}-picker`} className={sheet ? "modal compare-picker is-sheet" : "menu compare-picker"} role="dialog" aria-label={label} onBlur={onBlur} onMouseDown={keepFocus}>
      {sheet && <p className="compare-picker-title">{label}</p>}
      {open === "compare" && <div className="segmented compare-picker-tabs" role="group" aria-label={t("Compare")}>
        <button type="button" aria-pressed={tab === "uncommitted"} onClick={() => show("compare", "uncommitted")}>{t("Uncommitted")}</button>
        <button type="button" aria-pressed={tab === "staged"} onClick={() => show("compare", "staged")}>{t("Staged")}</button>
        <button type="button" aria-pressed={tab === "branches"} onClick={() => show("compare", "branches")}>{t("Branches")}</button>
      </div>}
      {listShown ? <>
        <input
          ref={field}
          className="input compare-picker-search"
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={names.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={active !== null && active < names.length ? optionId(active) : undefined}
          value={query ?? ""}
          placeholder={t("Branch, tag or commit")}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          onChange={(event) => step({ type: "input", text: event.target.value })}
          onKeyDown={onKeyDown}
        />
        <div ref={list} id={`${id}-list`} className="compare-picker-list" role="listbox" aria-label={label}>
          {group(t("Local"), local, "local", 0)}
          {group(t("Remote"), remote, "remote", local.length)}
        </div>
        {listLoading && <p className="compare-picker-note">{t("Loading…")}</p>}
        {truncated && <p className="compare-picker-note">{t("Only the newest remote branches are listed. Type a name to use another.")}</p>}
      </> : <div className="compare-picker-list">
        <button ref={tipRow} type="button" className="menu-item compare-picker-tip" aria-current={mode === tipShown || undefined} onClick={() => chooseTip(tipShown)}>
          <span className="compare-picker-mark">{mode === tipShown && <Check aria-hidden="true" />}</span>
          <span className="compare-picker-text">
            <span className="compare-picker-name">{tipShown === "staged" ? t("Staged") : t("Uncommitted")}</span>
            <span className="compare-picker-meta">{tipShown === "staged" ? t("What the next commit takes, against HEAD") : t("Staged, unstaged and untracked files against HEAD")}</span>
          </span>
        </button>
      </div>}
    </div>
  );

  return (
    <div className="compare-line">
      {/* Compare's part first in every mode, so a change of mode keeps its button (and its focus) */}
      {partButton("compare", mode === "branches"
        ? <>
          <span className="visually-hidden">{t("Compare")} </span>
          <GitBranch aria-hidden="true" />
          <span className="compare-part-name">{compare}</span>
        </>
        : <span className="compare-part-name">{mode === "staged" ? t("Staged changes") : t("Uncommitted changes")}</span>)}
      {mode === "branches" && <>
        <span className="compare-vs">{t("vs")}</span>
        {partButton("base", <>
          <span className="visually-hidden">{t("Base")} </span>
          {base.trim() === "" ? <span className="compare-part-name">{t("Choose a base")}</span> : <>
            <GitBranch aria-hidden="true" />
            <span className="compare-part-name">{base}</span>
          </>}
        </>)}
      </>}
      {/* a phone's sheet rises over its own scrim (styles.css `.modal-scrim`), inside the review, so its focus trap holds */}
      {picker !== null && (sheet ? <div className="modal-scrim compare-picker-scrim">{picker}</div> : picker)}
    </div>
  );
}
