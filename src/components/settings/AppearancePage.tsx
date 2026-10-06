import { Check } from "lucide-react";

import "./AppearancePage.css";

import { LANGUAGE_NAMES, LANGUAGE_SETTINGS, useT } from "../../lib/i18n.ts";
import { useSettings, type Palette } from "../../lib/settings.ts";
import { Segmented, SettingsGroup, SettingsRow } from "./SettingsUi.tsx";

const PALETTES: readonly Palette[] = ["amber", "report", "charcoal", "catppuccin"];

/** Settings → Appearance: the colours, the density, the sidebar's grouping and the language. */
export function AppearancePage() {
  const { settings, resolvedTheme, resolvedLanguage, update } = useSettings();
  const t = useT();
  const paletteName = (palette: Palette): string => t(palette === "report" ? "Dark report" : palette === "amber" ? "Amber" : palette === "catppuccin" ? "Catppuccin" : "Charcoal");
  return (
    <>
      <SettingsGroup title={t("Color")}>
        <SettingsRow label={t("Mode")} keywords="theme mode color dark light system" control={
          <Segmented label={t("Mode")} value={settings.theme} onChange={(theme) => update({ theme })}
            options={[{ value: "dark", label: t("Dark") }, { value: "light", label: t("Light") }, { value: "system", label: t("System") }]} />
        } />
        <SettingsRow label={t("Palette")} keywords="palette colors theme amber dark report charcoal catppuccin" stack control={
          // each preview carries its palette's tokens itself (src/styles.css keys them on data-theme and data-palette)
          <div className="palette-tiles" role="radiogroup" aria-label={t("Palette")}>
            {PALETTES.map((palette) => (
              <label key={palette} className="palette-tile">
                <input type="radio" className="visually-hidden" name="settings-palette" value={palette} checked={settings.palette === palette} onChange={() => update({ palette })} />
                <span className="palette-tile-preview" data-theme={resolvedTheme} data-palette={palette} aria-hidden="true">
                  <span className="palette-tile-side" />
                  <span className="palette-tile-main">
                    <span className="palette-tile-bar is-accent" />
                    <span className="palette-tile-bar is-text" />
                    <span className="palette-tile-bar is-edge" />
                  </span>
                </span>
                <span className="palette-tile-name">{paletteName(palette)}<Check aria-hidden="true" /></span>
              </label>
            ))}
          </div>
        } />
      </SettingsGroup>
      <SettingsGroup title={t("Interface")}>
        <SettingsRow label={t("Density")} description={t("Adjust spacing throughout the interface")} keywords="density spacing compact comfortable" control={
          <Segmented label={t("Density")} value={settings.density} onChange={(density) => update({ density })}
            options={[{ value: "comfortable", label: t("Comfortable") }, { value: "compact", label: t("Compact") }]} />
        } />
        <SettingsRow label={t("Group sidebar by")} description={t("Folder groups by the full path on each PC")} keywords="sidebar grouping group workspace folder directory" control={
          <Segmented label={t("Group sidebar by")} value={settings.sidebarGrouping} onChange={(sidebarGrouping) => update({ sidebarGrouping })}
            options={[{ value: "workspace", label: t("Workspace") }, { value: "directory", label: t("Folder") }]} />
        } />
        <SettingsRow label={t("Language")} description={t("System follows the browser")} keywords="language english korean japanese chinese system" control={
          <select className="select" aria-label={t("Language")} value={settings.language} onChange={(event) => update({ language: event.target.value as typeof settings.language })}>
            {LANGUAGE_SETTINGS.map((language) => (
              <option key={language} value={language}>{language === "system" ? t("System ({language})", { language: LANGUAGE_NAMES[resolvedLanguage] }) : LANGUAGE_NAMES[language]}</option>
            ))}
          </select>
        } />
      </SettingsGroup>
    </>
  );
}
