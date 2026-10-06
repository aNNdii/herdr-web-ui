import { useRef } from "react";

import { previewAlertSound, unlockAlertSound } from "../../lib/alertSound.ts";
import { useT } from "../../lib/i18n.ts";
import { useSettings } from "../../lib/settings.ts";
import { PushTestControls } from "../PushTestControls.tsx";
import { Segmented, SettingsGroup, SettingsRow, Toggle } from "./SettingsUi.tsx";

/** Settings → Notifications: this device's push alerts, what they are for, and how the open app says them. */
export function NotificationsPage({ onEnableNotifications }: { onEnableNotifications: () => Promise<boolean> }) {
  const { settings, update } = useSettings();
  const t = useT();
  // the Sound switch as last set: the preview waits for the audio, and must not play once it is off
  const alertSoundWanted = useRef(settings.alertSound);
  return (
    <>
      <SettingsGroup>
        <PushTestControls onEnable={onEnableNotifications} />
      </SettingsGroup>
      <SettingsGroup title={t("Notify me when")}>
        <SettingsRow label={t("An agent needs input")} description={t("A question or a permission request")} keywords="needs input notify alert question permission waiting answer" control={
          <Toggle label={t("An agent needs input")} checked={settings.alertInput} onChange={(alertInput) => update({ alertInput })} />
        } />
        <SettingsRow label={t("An agent finishes")} description={t("Long turns: only work that took a minute or more")} keywords="finished finishes done turn long every never notify alert" control={
          <Segmented label={t("An agent finishes")} value={settings.alertDone} onChange={(alertDone) => update({ alertDone })}
            options={[{ value: "off", label: t("Never") }, { value: "long", label: t("Long turns") }, { value: "always", label: t("Every turn") }]} />
        } />
      </SettingsGroup>
      <SettingsGroup title={t("While the app is open")}>
        <SettingsRow label={t("Banner")} description={t("Drops in from the top at once. Tap it to open the pane.")} keywords="in app banner drop in alert top" control={
          <Toggle label={t("Banner")} checked={settings.alertInApp} onChange={(alertInApp) => update({ alertInApp })} />
        } />
        <SettingsRow label={t("Sound")} description={t("A chime, also during Focus or Do Not Disturb")} keywords="sound chime audio focus do not disturb alert" control={
          <Toggle label={t("Sound")} checked={settings.alertSound} onChange={(alertSound) => {
            update({ alertSound });
            alertSoundWanted.current = alertSound;
            // this tap is the gesture the page needs to play audio; the chime is the preview,
            // unless the switch went off again while the audio was getting ready
            if (alertSound) void unlockAlertSound().then((ready) => { if (ready && alertSoundWanted.current) previewAlertSound(); });
          }} />
        } />
      </SettingsGroup>
    </>
  );
}
