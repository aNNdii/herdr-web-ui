import { useState } from "react";
import { ApiError } from "../lib/api.ts";
import { useT } from "../lib/i18n.ts";
import { pushSupported, testDevicePush } from "../lib/push.ts";
import { useSettings } from "../lib/settings.ts";
import { SettingsRow, SettingsTag } from "./settings/SettingsUi.tsx";

type Result = Awaited<ReturnType<typeof testDevicePush>> | "failed" | "sending" | null;

/** Settings → Notifications: whether this device gets push alerts, a test, and the way back after a lost subscription. */
export function PushTestControls({ onEnable }: { onEnable: () => Promise<boolean> }) {
  const { settings } = useSettings();
  const t = useT();
  const [result, setResult] = useState<Result>(null);
  const supported = pushSupported();
  const denied = globalThis.Notification?.permission === "denied";
  const busy = result === "sending";
  const enable = !settings.alertsOn || result === "missing" || result === "permission";
  const on = settings.alertsOn && supported && !denied;

  const send = async (repair: boolean) => {
    setResult("sending");
    try {
      if (repair) setResult(await onEnable() ? "sent" : "failed");
      else setResult(await testDevicePush());
    } catch (error) {
      setResult(error instanceof ApiError && error.code === "subscription_not_found" ? "missing" : "failed");
    }
  };

  const message = !supported || result === "unsupported" ? t("Push alerts need HTTPS or localhost, and on iPhone the home-screen app.")
    : denied ? t("Allow notifications in your browser settings, then try again.")
    : result === "sent" ? t("Test notification sent. Check this device for the alert.")
    : result === "missing" ? t("This device's push subscription is missing. Turn alerts on again.")
    : result === "permission" ? t("Allow notifications to test alerts on this device.")
    : result === "failed" ? t("Could not send the test notification. Try again.")
    : !settings.alertsOn ? t("Alerts off") : null;

  return (
    <SettingsRow
      className="push-test"
      label={t("Push notifications")}
      tag={<SettingsTag tone={on ? "ok" : undefined}>{t(on ? "On" : "Off")}</SettingsTag>}
      description={t("Check whether this device can receive push alerts")}
      keywords="push notifications alerts test send enable"
      control={<button type="button" className="btn btn-secondary" disabled={busy || !settings.alertsOn || !supported || denied} onClick={() => void send(false)}>{busy ? t("Sending…") : t("Send test")}</button>}
    >
      <p className="settings-note" role="status">{message}</p>
      {enable && supported && !denied && <div className="settings-field-row">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void send(true)}>{t("Turn alerts on again")}</button>
      </div>}
    </SettingsRow>
  );
}
