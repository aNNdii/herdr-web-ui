/**
 * The pieces every Settings page is built from (DESIGN.md → Settings dialog): a page, its groups
 * (a title, an optional intro, then one card of rows), the rows (label and description on the
 * left, the control on the right, or under them in a stacked row) and the small controls the
 * pages share. A row answers the dialog's search itself: while a search runs, only the rows
 * whose words match keep their place, and the groups and pages left without one hide
 * (SettingsUi.css, through :has()).
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Minus, Monitor, Plus, type LucideIcon } from "lucide-react";

import "./SettingsUi.css";

import { useT } from "../../lib/i18n.ts";
import { matchesSearch } from "../../lib/settingsSearch.ts";
import { formatKeys } from "../../lib/shortcuts.ts";

/** The search's words (lib/settingsSearch.ts searchWords); empty while nothing is searched. */
export const SettingsSearchContext = createContext<readonly string[]>([]);
/** The titles a row is found by besides its own words: its page's and its group's. */
const ScopeContext = createContext<readonly string[]>([]);

/**
 * Whether a row stays in the search's results: null while nothing is searched. The texts are
 * the row's own (label, description, English keywords); its page's and group's titles count too.
 */
export function useSearchHit(texts: ReadonlyArray<string | null | undefined>): boolean | null {
  const words = useContext(SettingsSearchContext);
  const scope = useContext(ScopeContext);
  if (words.length === 0) return null;
  return matchesSearch(words, [...texts, ...scope]);
}

/** Follows a media query: the layout choices CSS alone cannot make (focus, the deep link). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const onChange = (): void => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/**
 * One page. Its heading is drawn only in the search's results, where every page is shown at
 * once; the dialog's header names the page otherwise.
 */
export function SettingsPage({ id, title, icon: Icon, keywords, children }: { id: string; title: string; icon: LucideIcon; keywords: string; children: ReactNode }) {
  return (
    <section className="settings-page" data-page={id} aria-label={title}>
      <h3 className="settings-page-heading"><Icon aria-hidden="true" />{title}</h3>
      <ScopeContext.Provider value={[title, keywords]}>{children}</ScopeContext.Provider>
    </section>
  );
}

/** A group: a title (sentence case), an optional one-line intro, one card of rows, then the group's own buttons. */
export function SettingsGroup({ title, tag, intro, actions, children, className }: { title?: string; tag?: ReactNode; intro?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  const scope = useContext(ScopeContext);
  const body = (
    <section className={`settings-group${className ? ` ${className}` : ""}`}>
      {title && <h3 className="settings-group-title">{title}{tag}</h3>}
      {intro && <p className="settings-group-intro">{intro}</p>}
      <div className="settings-card">{children}</div>
      {actions && <div className="settings-group-actions">{actions}</div>}
    </section>
  );
  return title ? <ScopeContext.Provider value={[...scope, title]}>{body}</ScopeContext.Provider> : body;
}

export interface SettingsRowProps {
  label?: string;
  /** one short line; a string is searched, a node (keycaps) is not: say its words in `keywords` */
  description?: ReactNode;
  /** English words the row is also found by, whatever the language shown */
  keywords?: string;
  /** after the label: a state ("On") or where the setting lives ("Saved on the server PC") */
  tag?: ReactNode;
  /** a leading mark: a device, a PC, an account */
  icon?: ReactNode;
  /** on the right of the text, or under it in a stacked row */
  control?: ReactNode;
  /** the control under the text, full width: fields, lists, tiles */
  stack?: boolean;
  /** whether a search can find it; a decoration (the terminal preview) cannot */
  searchable?: boolean;
  className?: string;
  /** under the row's line: notes, errors, a second set of buttons */
  children?: ReactNode;
}

export function SettingsRow({ label, description, keywords, tag, icon, control, stack = false, searchable = true, className, children }: SettingsRowProps) {
  const hit = useSearchHit([label, typeof description === "string" ? description : null, keywords]);
  const classes = ["settings-row", stack ? "is-stack" : "", searchable && hit === true ? "is-hit" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      {(icon || label || description || control) && <div className="settings-row-main">
        {icon && <span className="settings-row-icon" aria-hidden="true">{icon}</span>}
        {(label || description) && (
          <div className="settings-row-text">
            {label && <span className="settings-row-label">{label}{tag}</span>}
            {description && <span className="settings-row-desc">{description}</span>}
          </div>
        )}
        {control && <div className="settings-row-control">{control}</div>}
      </div>}
      {children}
    </div>
  );
}

/** A small pill after a label: a state, or where a setting is kept. */
export function SettingsTag({ children, tone, icon: Icon }: { children: ReactNode; tone?: "ok"; icon?: LucideIcon }) {
  return <span className={`settings-tag${tone ? ` is-${tone}` : ""}`}>{Icon && <Icon aria-hidden="true" />}{children}</span>;
}

/** Marks a setting the server keeps for every device, not this browser. */
export function ServerTag() {
  const t = useT();
  return <SettingsTag icon={Monitor}>{t("Saved on the server PC")}</SettingsTag>;
}

/** On or off: a solid primary track when on. A 48×40 target around a 44×26 track. */
export function Toggle({ checked, label, onChange, disabled = false }: { checked: boolean; label: string; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" className="settings-toggle" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="settings-toggle-thumb" />
    </button>
  );
}

/** One choice of a few, shown at once. Full width on a phone. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <div className="segmented settings-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}
    </div>
  );
}

/** A number stepped by one between its limits: − value + */
export function Stepper({ label, value, display, min, max, decreaseLabel, increaseLabel, onChange }: { label: string; value: number; display: string; min: number; max: number; decreaseLabel: string; increaseLabel: string; onChange: (value: number) => void }) {
  return (
    <div className="settings-stepper" role="group" aria-label={label}>
      <button type="button" aria-label={decreaseLabel} disabled={value <= min} onClick={() => onChange(value - 1)}><Minus aria-hidden="true" /></button>
      <output aria-live="polite">{display}</output>
      <button type="button" aria-label={increaseLabel} disabled={value >= max} onClick={() => onChange(value + 1)}><Plus aria-hidden="true" /></button>
    </div>
  );
}

/** Keycaps for a key list (`["Mod", "Enter"]`), Mod resolved for this platform. */
export function KeyCaps({ keys }: { keys: readonly string[] }) {
  return <span className="settings-keys">{formatKeys(keys).map((key) => <kbd key={key} className="kbd">{key}</kbd>)}</span>;
}

/** A translated sentence with its `{keys}` placeholder drawn as keycaps. */
export function withKeys(sentence: string, keys: readonly string[]): ReactNode {
  const at = sentence.indexOf("{keys}");
  if (at < 0) return sentence;
  return <>{sentence.slice(0, at)}<KeyCaps keys={keys} />{sentence.slice(at + "{keys}".length)}</>;
}
