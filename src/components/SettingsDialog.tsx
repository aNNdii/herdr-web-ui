/**
 * Settings: a fixed-size window over the app, which stays in view behind it (appearance changes
 * show at once). A navigation column (search, pages in groups) beside the page; on a phone, full
 * screen, the list of pages first and a page after a tap, as in a phone's own settings. While
 * the search has text every page is drawn and only the matching rows stay (settings/SettingsUi).
 * The open page is in the address (#settings/<page>, lib/settingsSearch.ts) until it closes.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bell, ChartLine, Check, ChevronLeft, ChevronRight, Contrast, Info, Keyboard, MessageSquare, Mic, Monitor, Search, Smartphone, SquareTerminal, X, type LucideIcon } from "lucide-react";

import "./SettingsDialog.css";

import type { AppActions } from "../lib/actions.ts";
import { useT } from "../lib/i18n.ts";
import { runningAppVersion } from "../lib/runningVersion.ts";
import { useSettings } from "../lib/settings.ts";
import { parseSettingsHash, searchWords, settingsHash, type SettingsPageId } from "../lib/settingsSearch.ts";
import { formatKeys } from "../lib/shortcuts.ts";
import type { UpdatesModel } from "../lib/updates.ts";
import type { Machine } from "../../shared/machines.ts";
import type { HealthAuth } from "../../shared/protocol.ts";
import { AboutPage } from "./settings/AboutPage.tsx";
import { AppearancePage } from "./settings/AppearancePage.tsx";
import { ChatPage } from "./settings/ChatPage.tsx";
import { DevicesPage } from "./settings/DevicesPage.tsx";
import { NotificationsPage } from "./settings/NotificationsPage.tsx";
import { RemotePcsPage } from "./settings/RemotePcsPage.tsx";
import { SettingsPage, SettingsSearchContext, useMediaQuery } from "./settings/SettingsUi.tsx";
import { ShortcutsPage } from "./settings/ShortcutsPage.tsx";
import { TerminalPage } from "./settings/TerminalPage.tsx";
import { UsagePage } from "./settings/UsagePage.tsx";
import { VoicePage } from "./settings/VoicePage.tsx";

declare const __APP_VERSION__: string;

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  actions: AppActions;
  updates: UpdatesModel;
  /** how this browser got in, from the last health check */
  auth: HealthAuth | null;
  /** the herdr this app's server talks to, from the last health check */
  herdrVersion: string | null;
  onEnableNotifications: () => Promise<boolean>;
  /** the page to open on; else the address's #settings/<page>, else Appearance */
  page?: SettingsPageId | null;
  /** App's PC roster, for Remote PCs */
  machines?: Machine[];
  /** a PC's setup dialog, as its sidebar group opens it (Settings closes first) */
  onSetupMachine?: (machine: Machine, update?: boolean) => void;
  /** a PC was removed from Remote PCs */
  onMachineRemoved?: (machineId: string) => void;
}

/** The phone layout, as the modal primitive's (src/styles.css) */
const PHONE_QUERY = "(max-width: 640px)";

interface NavItem {
  id: SettingsPageId;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  /** English words the whole page is found by */
  keywords: string;
  /** the current values in one line, under the name in a phone's list; null when there is nothing to say without asking the server */
  summary: string | null;
}

export function SettingsDialog(props: SettingsDialogProps) {
  // mounted while open only: each opening starts from its page, and each page fetches what it shows when it mounts
  return props.open ? <SettingsWindow {...props} /> : null;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(target.type);
}

function SettingsWindow({ onClose, actions, updates, auth, herdrVersion, onEnableNotifications, page: askedPage = null, machines = [], onSetupMachine, onMachineRemoved }: SettingsDialogProps) {
  const t = useT();
  const phone = useMediaQuery(PHONE_QUERY);
  const [page, setPage] = useState<SettingsPageId>(() => askedPage ?? parseSettingsHash(window.location.hash)?.page ?? "appearance");
  // a phone shows the list of pages until one is picked; a link to a page opens on it
  const [detail, setDetail] = useState(() => askedPage !== null || (parseSettingsHash(window.location.hash)?.page ?? null) !== null);
  const [query, setQuery] = useState("");
  const words = useMemo(() => searchWords(query), [query]);
  const searching = words.length > 0;
  const surfaceRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  // App asks for another page while open (a #settings/<page> typed into the address)
  const firstAsk = useRef(true);
  useEffect(() => {
    if (firstAsk.current) { firstAsk.current = false; return; }
    if (askedPage === null) return;
    setPage(askedPage);
    setDetail(true);
    setQuery("");
  }, [askedPage]);

  // the address names the open page, so a reload or a shared link comes back to it; closing takes it away
  useEffect(() => {
    const hash = settingsHash(phone && !detail && !searching ? null : page);
    if (window.location.hash !== hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + hash);
  }, [page, detail, phone, searching]);
  useEffect(() => () => {
    if (parseSettingsHash(window.location.hash) !== null) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }, []);

  // a keyboard starts in the search; a touch screen gets no field focused, which would raise its keyboard
  useEffect(() => {
    const home = (): void => {
      if (window.matchMedia?.("(pointer: coarse)").matches) surfaceRef.current?.focus({ preventScroll: true });
      else searchRef.current?.focus({ preventScroll: true });
    };
    home();
    // the app under it keeps its hands off the focus while Settings is up: a terminal that takes
    // it (Settings opened by a link, before the pane attached) or a Tab past the last control
    // comes back here. A menu or a confirm Settings opens is drawn outside #root and keeps it.
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target as Node | null;
      const surface = surfaceRef.current;
      if (!surface || !target || surface.contains(target) || !document.getElementById("root")?.contains(target)) return;
      home();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  // another page, or another search, starts at its top
  useLayoutEffect(() => { bodyRef.current?.scrollTo?.({ top: 0 }); }, [page, searching]);

  const latest = useRef({ query, phone, onClose });
  latest.current = { query, phone, onClose };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        // a search is cleared first; the next Escape closes
        if (latest.current.query !== "") setQuery("");
        else latest.current.onClose();
        return;
      }
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || isEditable(event.target)) return;
      event.preventDefault();
      // on a phone the field is on the list of pages: back to it first
      if (!latest.current.phone) searchRef.current?.focus();
      else {
        setDetail(false);
        window.requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const go = (id: SettingsPageId): void => {
    setPage(id);
    setDetail(true);
    setQuery("");
    // on a phone the list goes away with the button that was pressed
    if (phone) window.requestAnimationFrame(() => backRef.current?.focus({ preventScroll: true }));
  };
  const back = (): void => {
    setDetail(false);
    window.requestAnimationFrame(() => surfaceRef.current?.querySelector<HTMLElement>(`.settings-nav-item[data-page="${page}"]`)?.focus({ preventScroll: true }));
  };

  const nav = useNav(machines, updates);
  const items = nav.flatMap((section) => section.items);
  const current = items.find((item) => item.id === page) ?? items[0]!;

  const content = (id: SettingsPageId): ReactNode => {
    switch (id) {
      case "appearance": return <AppearancePage />;
      case "terminal": return <TerminalPage />;
      case "chat": return <ChatPage />;
      case "voice": return <VoicePage />;
      case "notifications": return <NotificationsPage onEnableNotifications={onEnableNotifications} />;
      case "shortcuts": return <ShortcutsPage />;
      case "devices": return <DevicesPage auth={auth} />;
      case "remote-pcs": return <RemotePcsPage machines={machines} onAddPc={actions.openAddPc} onSetup={(machine, update) => onSetupMachine?.(machine, update)} onRemoved={(id) => onMachineRemoved?.(id)} />;
      case "usage": return <UsagePage />;
      case "about": return <AboutPage updates={updates} herdrVersion={herdrVersion} />;
    }
  };

  return (
    <div className="modal-scrim settings-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={surfaceRef}
        tabIndex={-1}
        className={`modal settings-dialog${detail ? " is-detail" : ""}${searching ? " is-searching" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <aside className="settings-nav">
          <div className="settings-nav-head">
            <h2 className="settings-nav-title" id="settings-title">{t("Settings")}</h2>
            <button type="button" className="icon-button settings-nav-close" aria-label={t("Close settings")} onClick={onClose}><X /></button>
          </div>
          <label className="settings-search">
            <Search aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={t("Search settings")}
              aria-label={t("Search settings")}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd className="kbd" aria-hidden="true">/</kbd>
          </label>
          <nav className="settings-nav-list" aria-label={t("Settings sections")}>
            {nav.map((section) => (
              <div key={section.title} className="settings-nav-section">
                <p className="settings-nav-group">{section.title}</p>
                <div className="settings-nav-items">
                  {section.items.map((item) => (
                    <button key={item.id} type="button" className="settings-nav-item" data-page={item.id} aria-current={!searching && item.id === page ? "page" : undefined} onClick={() => go(item.id)}>
                      <item.icon className="settings-nav-icon" aria-hidden="true" />
                      <span className="settings-nav-text">
                        <span className="settings-nav-label">{item.title}</span>
                        {item.summary && <span className="settings-nav-summary">{item.summary}</span>}
                      </span>
                      <ChevronRight className="settings-nav-chevron" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <p className="settings-nav-foot"><Check aria-hidden="true" />{t("Changes save automatically")}</p>
        </aside>
        <div className="settings-content">
          <header className="settings-content-head">
            <button ref={backRef} type="button" className="icon-button settings-back" aria-label={t("All settings")} onClick={back}><ChevronLeft /></button>
            <div className="settings-content-titles">
              <h2 className="settings-content-title">{searching ? t("Search results") : current.title}</h2>
              <p className="settings-content-subtitle">{searching ? t("Across all sections") : current.subtitle}</p>
            </div>
            <button type="button" className="icon-button settings-content-close" aria-label={t("Close settings")} onClick={onClose}><X /></button>
          </header>
          <div ref={bodyRef} className={`settings-content-body${searching ? " is-searching" : ""}`}>
            <SettingsSearchContext.Provider value={words}>
              <div className="settings-results">
                {searching && <p className="settings-empty" role="status">{t("No settings match “{query}”.", { query: query.trim() })}</p>}
                {(searching ? items : [current]).map((item) => (
                  <SettingsPage key={item.id} id={item.id} title={item.title} icon={item.icon} keywords={item.keywords}>{content(item.id)}</SettingsPage>
                ))}
              </div>
            </SettingsSearchContext.Provider>
          </div>
        </div>
      </section>
    </div>
  );
}

/** The navigation: three groups of pages, each with its title, its line under the header, and a phone's summary of it. */
function useNav(machines: readonly Machine[], updates: UpdatesModel): Array<{ title: string; items: NavItem[] }> {
  const t = useT();
  const { settings } = useSettings();
  const join = (...parts: Array<string | null | false>): string | null => {
    const kept = parts.filter((part): part is string => typeof part === "string" && part !== "");
    return kept.length > 0 ? kept.join(" · ") : null;
  };
  const palette = t(settings.palette === "report" ? "Dark report" : settings.palette === "amber" ? "Amber" : settings.palette === "catppuccin" ? "Catppuccin" : "Charcoal");
  const terminalFont = settings.terminalFontFamily.split(",")[0]?.replace(/["']/g, "").trim() ?? "";
  const remote = machines.filter((machine) => machine.kind === "ssh");
  const overrides = Object.keys(settings.shortcutOverrides).length;
  const status = updates.status;
  const byId: Record<SettingsPageId, Omit<NavItem, "id">> = {
    appearance: {
      icon: Contrast, title: t("Appearance"), subtitle: t("How herdr web ui looks on this device."), keywords: "appearance look theme",
      summary: join(t(settings.theme === "dark" ? "Dark" : settings.theme === "light" ? "Light" : "System"), palette, t(settings.density === "compact" ? "Compact" : "Comfortable")),
    },
    terminal: {
      icon: SquareTerminal, title: t("Terminal"), subtitle: t("Applies to every terminal pane on this device."), keywords: "terminal",
      summary: join(`${settings.terminalFontSize} px`, terminalFont),
    },
    chat: {
      icon: MessageSquare, title: t("Chat"), subtitle: t("The chat view of agent panes and its message box."), keywords: "chat conversation composer",
      summary: join(settings.enterSends ? t("Enter sends") : t("{keys} sends", { keys: formatKeys(["Mod", "Enter"]).join("+") }), settings.showQuickReplies && t("Quick replies")),
    },
    voice: {
      icon: Mic, title: t("Voice input"), subtitle: t("Dictate into the message box and the terminal input line."), keywords: "voice input dictation speech microphone",
      summary: t(settings.voiceInput ? "On" : "Off"),
    },
    notifications: {
      icon: Bell, title: t("Notifications"), subtitle: t("Alerts wait a moment and are skipped if you already answered at the PC."), keywords: "notifications alerts push",
      summary: settings.alertsOn
        ? join(settings.alertInput && t("Needs input"), settings.alertDone === "long" ? t("Long turns") : settings.alertDone === "always" ? t("Every turn") : null) ?? t("Off")
        : t("Off on this device"),
    },
    shortcuts: {
      icon: Keyboard, title: t("Keyboard shortcuts"), subtitle: t("Some keys are reserved by the browser. Off sends the keys to the terminal."), keywords: "keyboard shortcuts keys hotkeys",
      summary: overrides === 0 ? t("Defaults") : t("{n} changed", { n: overrides }),
    },
    devices: {
      icon: Smartphone, title: t("Phone & devices"), subtitle: t("Open herdr web ui on your phone and choose who has access."), keywords: "phone devices mobile pairing access",
      summary: settings.keepScreenOn ? t("Keep screen on") : null,
    },
    "remote-pcs": {
      icon: Monitor, title: t("Remote PCs"), subtitle: t("Other PCs over SSH. Their workspaces join the sidebar."), keywords: "remote pcs machines computers ssh",
      summary: machines.length === 0 ? null : remote.length === 0 ? t("None added") : t("{n} connected", { n: remote.filter((machine) => machine.state === "connected").length }),
    },
    usage: {
      icon: ChartLine, title: t("Plan usage"), subtitle: t("Meters beside Settings for the AI plans used on the server PC."), keywords: "plan usage subscription limits",
      summary: settings.showUsage ? join(t(settings.usageCount === "used" ? "Used" : "Remaining"), t(settings.usageGlance === "week" ? "Weekly" : "Session")) : t("Off"),
    },
    about: {
      icon: Info, title: t("About & updates"), subtitle: t("Versions of herdr web ui and the herdr it talks to."), keywords: "about updates version",
      summary: join(runningAppVersion(status, __APP_VERSION__), status?.available ? t("Update available") : null),
    },
  };
  const item = (id: SettingsPageId): NavItem => ({ id, ...byId[id] });
  // in SETTINGS_PAGES' order (lib/settingsSearch.ts)
  const groups: Array<{ title: string; ids: SettingsPageId[] }> = [
    { title: t("This device"), ids: ["appearance", "terminal", "chat", "voice", "notifications", "shortcuts"] },
    { title: t("Server & connections"), ids: ["devices", "remote-pcs", "usage"] },
    { title: "herdr web ui", ids: ["about"] },
  ];
  return groups.map((group) => ({ title: group.title, items: group.ids.map(item) }));
}
