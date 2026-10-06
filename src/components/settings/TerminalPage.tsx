import "./TerminalPage.css";

import { useT } from "../../lib/i18n.ts";
import { terminalFontStack } from "../../lib/fontFamily.ts";
import { KEY_BAR_EXTRAS } from "../../lib/keys.ts";
import { TERMINAL_FONT_MAX, TERMINAL_FONT_MIN, TERMINAL_WHEEL_SPEED_MAX, TERMINAL_WHEEL_SPEED_MIN, useSettings, type Settings } from "../../lib/settings.ts";
import { EXTRA_KEY_CAPS } from "../KeyBar.tsx";
import { FontFamilyInput } from "./FontFamilyInput.tsx";
import { SettingsGroup, SettingsRow, Stepper } from "./SettingsUi.tsx";

/** Settings → Terminal: the grid's type, how typing reaches it, the wheel, and the touch key bar. */
export function TerminalPage() {
  const { settings, update } = useSettings();
  const t = useT();
  const modes: ReadonlyArray<{ value: Settings["terminalInputMode"]; label: string; description: string }> = [
    // PaneTerminal: auto types straight into the grid with a fine pointer, and keeps the input line on a touch screen
    { value: "auto", label: t("Automatic"), description: t("Input line on touch screens, direct typing with a mouse and keyboard") },
    { value: "line", label: t("Input line"), description: t("Write a command first, then send it") },
    { value: "direct", label: t("Direct typing"), description: t("Every key goes straight to the terminal") },
  ];
  return (
    <>
      <SettingsGroup title={t("Text")}>
        <SettingsRow searchable={false} stack control={
          <div className="terminal-preview" aria-hidden="true" style={{ fontFamily: terminalFontStack(settings.terminalFontFamily), fontSize: `${settings.terminalFontSize}px` }}>
            <span className="terminal-preview-prompt">~/herdr-web-ui $</span> bun test{"\n"}
            <span className="terminal-preview-ok">✓</span> 214 pass <span className="terminal-preview-selection">(1.84 s)</span><span className="terminal-preview-cursor"> </span>
          </div>
        } />
        <SettingsRow label={t("Font size")} keywords="terminal font size text" control={
          <Stepper label={t("Terminal font size")} value={settings.terminalFontSize} display={`${settings.terminalFontSize} px`} min={TERMINAL_FONT_MIN} max={TERMINAL_FONT_MAX}
            decreaseLabel={t("Decrease terminal font size")} increaseLabel={t("Increase terminal font size")} onChange={(terminalFontSize) => update({ terminalFontSize })} />
        } />
        <SettingsRow label={t("Font")} description={t("Comma-separated, tried in order. Missing fonts fall back to the default.")} keywords="terminal font family typeface" stack control={
          <FontFamilyInput mono value={settings.terminalFontFamily} label={t("Terminal font")} onCommit={(terminalFontFamily) => update({ terminalFontFamily })} />
        } />
      </SettingsGroup>
      <SettingsGroup title={t("Input & scrolling")}>
        <SettingsRow label={t("Typing")} keywords="terminal input mode automatic line direct typing keyboard" stack control={
          <div className="settings-radios" role="radiogroup" aria-label={t("Terminal input mode")}>
            {modes.map((mode) => (
              <label key={mode.value} className="settings-radio">
                <input type="radio" name="settings-terminal-input-mode" value={mode.value} checked={settings.terminalInputMode === mode.value} onChange={() => update({ terminalInputMode: mode.value })} />
                <span className="settings-radio-text">
                  <span className="settings-radio-label">{mode.label}</span>
                  <span className="settings-radio-desc">{mode.description}</span>
                </span>
              </label>
            ))}
          </div>
        } />
        <SettingsRow label={t("Wheel scroll speed")} description={t("How far one turn of the wheel scrolls the terminal")} keywords="wheel scroll speed mouse" control={
          <Stepper label={t("Wheel scroll speed")} value={settings.terminalWheelSpeed} display={`${settings.terminalWheelSpeed}×`} min={TERMINAL_WHEEL_SPEED_MIN} max={TERMINAL_WHEEL_SPEED_MAX}
            decreaseLabel={t("Slower wheel scrolling")} increaseLabel={t("Faster wheel scrolling")} onChange={(terminalWheelSpeed) => update({ terminalWheelSpeed })} />
        } />
      </SettingsGroup>
      <SettingsGroup title={t("Key bar")} intro={t("Extra keys in the bar under the terminal on a touch screen. Esc, Tab, Ctrl, the arrows and ^C are always there.")}>
        <SettingsRow label={t("Extra keys")} keywords="key bar extra keys touch alt tab home end page ctrl pipe tilde slash" stack control={
          // drawn as the caps they put in the bar (KeyBar.css)
          <div className="key-bar-extras" role="group" aria-label={t("Key bar")}>
            {KEY_BAR_EXTRAS.map((extra) => {
              const { cap, label } = EXTRA_KEY_CAPS[extra];
              const on = settings.keyBarExtras.includes(extra);
              return (
                <button key={extra} type="button" aria-pressed={on} aria-label={label ? t(label) : undefined} title={label ? t(label) : undefined}
                  onClick={() => update({ keyBarExtras: on ? settings.keyBarExtras.filter((chosen) => chosen !== extra) : [...settings.keyBarExtras, extra] })}>
                  {cap}
                </button>
              );
            })}
          </div>
        } />
      </SettingsGroup>
    </>
  );
}
