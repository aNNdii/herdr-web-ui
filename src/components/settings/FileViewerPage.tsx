import { formatBytes } from "../../lib/bridgeProgress.ts";
import { useT } from "../../lib/i18n.ts";
import { MARKDOWN_WIDTHS, SIZE_LIMIT_CHOICES, useSettings } from "../../lib/settings.ts";
import { Segmented, SettingsGroup, SettingsRow, Toggle } from "./SettingsUi.tsx";

/** Settings → File viewer: how a file opened from a pane reads, and how much of a large one loads. */
export function FileViewerPage() {
  const { settings, update } = useSettings();
  const t = useT();
  // literal keys, so the i18n check finds them
  const markdownWidthLabel = { readable: t("Default"), full: t("Full width") };
  // the segmented control keys its options by string; the limits are byte counts
  const sizeOptions = SIZE_LIMIT_CHOICES.map((limit) => ({ value: String(limit), label: formatBytes(limit) }));
  return (
    <>
      <SettingsGroup>
        <SettingsRow label={t("Wrap long lines")} keywords="wrap long lines code file viewer" control={
          <Toggle label={t("Wrap long lines")} checked={settings.wrapCode} onChange={(wrapCode) => update({ wrapCode })} />
        } />
        <SettingsRow label={t("Markdown width")} keywords="markdown width readable full preview file viewer" control={
          <Segmented label={t("Markdown width")} value={settings.markdownWidth} onChange={(markdownWidth) => update({ markdownWidth })}
            options={MARKDOWN_WIDTHS.map((width) => ({ value: width, label: markdownWidthLabel[width] }))} />
        } />
      </SettingsGroup>
      <SettingsGroup title={t("Large files")} intro={t("A longer file shows its start, and Raw opens all of it. Past the highlight limit, code shows without colors.")}>
        <SettingsRow label={t("Load text files up to")} keywords="load text files size limit large file viewer" control={
          <Segmented label={t("Load text files up to")} value={String(settings.textLoadLimit)} onChange={(value) => update({ textLoadLimit: Number(value) })} options={sizeOptions} />
        } />
        <SettingsRow label={t("Highlight syntax up to")} keywords="highlight syntax colors files size limit large file viewer" control={
          <Segmented label={t("Highlight syntax up to")} value={String(settings.highlightLimit)} onChange={(value) => update({ highlightLimit: Number(value) })} options={sizeOptions} />
        } />
      </SettingsGroup>
    </>
  );
}
