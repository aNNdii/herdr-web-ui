import { useT } from "../../lib/i18n.ts";
import { useSettings } from "../../lib/settings.ts";
import { SHORTCUTS, formatKeys, shortcutConflict, shortcutKeys } from "../../lib/shortcuts.ts";
import { KeyCaps, SettingsGroup, SettingsRow } from "./SettingsUi.tsx";

function compactKeys(keys: readonly string[]): string {
  return formatKeys(keys).map((key) => ({ Shift: "⇧", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" }[key] ?? (key.length === 1 ? key.toUpperCase() : key))).join("+");
}

const KEYS = [..."abcdefghijklmnopqrstuvwxyz0123456789,", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

/** Settings → Keyboard shortcuts: every Mod+Shift binding, each changeable or off on this device. */
export function ShortcutsPage() {
  const { settings, update } = useSettings();
  const t = useT();
  return (
    <SettingsGroup actions={<button type="button" className="btn btn-tertiary" onClick={() => update({ shortcutOverrides: {} })}>{t("Reset all shortcuts")}</button>}>
      {SHORTCUTS.map((shortcut) => (
        <SettingsRow key={shortcut.id} className="settings-shortcut" label={t(shortcut.label)} keywords={`shortcut keyboard key ${shortcut.label} ${shortcut.id}`} control={
          // held, not dispatched (VoiceInput.tsx listens for it itself): its keys are fixed
          shortcut.id === "voice" ? <KeyCaps keys={shortcut.keys} /> : (
            <select className="select" aria-label={t(shortcut.label)} value={Object.hasOwn(settings.shortcutOverrides, shortcut.id) ? settings.shortcutOverrides[shortcut.id] ?? "off" : "default"} onChange={(event) => {
              const next = { ...settings.shortcutOverrides };
              if (event.target.value === "default") delete next[shortcut.id];
              else next[shortcut.id] = event.target.value === "off" ? null : event.target.value;
              update({ shortcutOverrides: next });
            }}>
              <option value="default" title={t("Default")} disabled={shortcutConflict(shortcut.id, shortcutKeys(shortcut.id, {}), settings.shortcutOverrides)}>{compactKeys(shortcut.keys)}</option>
              <option value="off" title={t("Send keys to terminal")}>{t("Off")}</option>
              {KEYS.map((key) => {
                const conflict = shortcutConflict(shortcut.id, [key], settings.shortcutOverrides);
                return <option key={key} value={key} disabled={conflict}>{compactKeys(["Mod", "Shift", key])}{conflict ? " — " + t("Already assigned") : ""}</option>;
              })}
            </select>
          )
        } />
      ))}
    </SettingsGroup>
  );
}
