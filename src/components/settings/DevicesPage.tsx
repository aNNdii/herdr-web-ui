import { useCallback, useEffect, useState } from "react";

import { fetchRemoteAccess } from "../../lib/api.ts";
import { useT } from "../../lib/i18n.ts";
import { useInstallPrompt } from "../../lib/install.ts";
import { isLoopbackHost, phonePlan } from "../../lib/phone.ts";
import { useSettings } from "../../lib/settings.ts";
import type { HealthAuth, RemoteAccess } from "../../../shared/protocol.ts";
import { DevicesPanel } from "../DevicesPanel.tsx";
import { PhonePanel } from "../PhonePanel.tsx";
import { SettingsGroup, SettingsRow, SettingsTag, Toggle } from "./SettingsUi.tsx";

/** Settings → Phone & devices: how a phone opens this app, keeping its screen on, installing, and who is paired. */
export function DevicesPage({ auth }: { auth: HealthAuth | null }) {
  const { settings, update } = useSettings();
  const t = useT();
  const installPrompt = useInstallPrompt();
  // what Tailscale on the server's PC already serves
  const [access, setAccess] = useState<RemoteAccess | null | undefined>(undefined);
  const loadAccess = useCallback(() => {
    setAccess(undefined);
    fetchRemoteAccess().then(setAccess, () => setAccess(null));
  }, []);
  useEffect(() => loadAccess(), [loadAccess]);
  const plan = phonePlan({ protocol: window.location.protocol, hostname: window.location.hostname, origin: window.location.origin, secure: window.isSecureContext }, access ?? null);
  // where a phone can open this app now, for the pairing QR code: the served address, else this one when it is not loopback
  const pairUrl = plan.kind === "here" || plan.kind === "served" ? plan.url : isLoopbackHost(window.location.hostname) ? null : window.location.origin;

  return (
    <>
      <SettingsGroup title={t("Open on your phone")}>
        <PhonePanel plan={plan} loading={access === undefined} onRefresh={loadAccess} />
        <SettingsRow label={t("Keep screen on")} description={t("While a terminal or chat pane is open. Requires HTTPS or localhost and a supported browser.")} keywords="keep screen on awake wake lock phone" control={
          <Toggle label={t("Keep screen on")} checked={settings.keepScreenOn} onChange={(keepScreenOn) => update({ keepScreenOn })} />
        } />
        <SettingsRow label={t("Install as an app")} keywords="install app pwa home screen dock"
          tag={installPrompt.installed ? <SettingsTag tone="ok">{t("Installed")}</SettingsTag> : undefined}
          description={installPrompt.installed || installPrompt.canInstall ? t("Its own window; on iPhone, also needed for push alerts") : installPrompt.help}
          control={!installPrompt.installed && installPrompt.canInstall ? <button type="button" className="btn btn-secondary" onClick={() => void installPrompt.install()}>{t("Install app")}</button> : undefined} />
      </SettingsGroup>
      <DevicesPanel pairUrl={pairUrl} auth={auth} />
    </>
  );
}
