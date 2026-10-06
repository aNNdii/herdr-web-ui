import { ChevronDown, ChevronUp } from "lucide-react";

import "./UsagePage.css";

import { useT } from "../../lib/i18n.ts";
import { useSettings } from "../../lib/settings.ts";
import { moveInOrder, orderProviders, PROVIDER_MARK, PROVIDER_NAME, usageName, useUsage } from "../../lib/usage.ts";
import type { ProviderUsage } from "../../../shared/protocol.ts";
import { AgentMark } from "../AgentMark.tsx";
import { Segmented, SettingsGroup, SettingsRow, Toggle } from "./SettingsUi.tsx";

/** Settings → Plan usage: the meters beside Settings, what they count, and which accounts in what order. */
export function UsagePage() {
  const { settings, update } = useSettings();
  const t = useT();
  // the accounts to order and hide: the same report the meters show, from the server's cache
  const usage = useUsage(settings.showUsage);
  const providers = usage.report?.providers ?? [];
  return (
    <>
      <SettingsGroup>
        <SettingsRow label={t("Show plan limits")} description={t("Sends the AI tools' sign-ins on the server PC to each provider's usage endpoint")} keywords="show plan limits subscription usage meters claude codex" control={
          <Toggle label={t("Show plan limits")} checked={settings.showUsage} onChange={(showUsage) => update({ showUsage })} />
        } />
        {settings.showUsage && (
          <SettingsRow label={t("Meters show")} keywords="usage meters show used remaining left" control={
            <Segmented label={t("Meters show")} value={settings.usageCount} onChange={(usageCount) => update({ usageCount })}
              options={[{ value: "used", label: t("Used") }, { value: "left", label: t("Remaining") }]} />
          } />
        )}
        {settings.showUsage && (
          <SettingsRow label={t("Limit shown")} description={t("Session is the 5-hour limit on Claude and Codex")} keywords="usage limit shown weekly week session" control={
            <Segmented label={t("Limit shown")} value={settings.usageGlance} onChange={(usageGlance) => update({ usageGlance })}
              options={[{ value: "week", label: t("Weekly") }, { value: "session", label: t("Session") }]} />
          } />
        )}
      </SettingsGroup>
      {settings.showUsage && providers.length > 0 && <UsageAccounts providers={providers} />}
    </>
  );
}

/** The accounts the plan meters know, in the strip's order: each row moves up or down and shows or hides. */
function UsageAccounts({ providers }: { providers: readonly ProviderUsage[] }) {
  const { settings, update } = useSettings();
  const t = useT();
  const ordered = orderProviders(providers, settings.usageOrder);
  const keys = ordered.map((usage) => usage.key);
  const move = (key: string, by: -1 | 1) => update({ usageOrder: moveInOrder(keys, settings.usageOrder, key, by) });
  return (
    <SettingsGroup className="usage-accounts" title={t("Accounts")} intro={t("A hidden account stays out of the meters and their popover.")}>
      {ordered.map((usage, index) => {
        const name = usageName(usage);
        const hidden = settings.usageHidden.includes(usage.key);
        return (
          <SettingsRow key={usage.key} className={`usage-accounts-row${hidden ? " is-hidden" : ""}`} icon={<AgentMark agent={PROVIDER_MARK[usage.id]} size={16} />}
            label={PROVIDER_NAME[usage.id]} description={usage.account ?? undefined} keywords={`usage account ${PROVIDER_NAME[usage.id]} ${usage.account ?? ""}`}
            control={<>
              <button type="button" className="icon-button" aria-label={t("Move {name} up", { name })} title={t("Move {name} up", { name })} disabled={index === 0} onClick={() => move(usage.key, -1)}><ChevronUp aria-hidden="true" /></button>
              <button type="button" className="icon-button" aria-label={t("Move {name} down", { name })} title={t("Move {name} down", { name })} disabled={index === ordered.length - 1} onClick={() => move(usage.key, 1)}><ChevronDown aria-hidden="true" /></button>
              <Toggle label={t("Show {name}", { name })} checked={!hidden}
                onChange={() => update({ usageHidden: hidden ? settings.usageHidden.filter((key) => key !== usage.key) : [...settings.usageHidden, usage.key] })} />
            </>} />
        );
      })}
    </SettingsGroup>
  );
}
