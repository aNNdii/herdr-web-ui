import { Globe, Star } from "lucide-react";

import { useT } from "../../lib/i18n.ts";
import type { UpdatesModel } from "../../lib/updates.ts";
import { HerdrUpdateControls, UpdateControls } from "../UpdateControls.tsx";
import { SettingsGroup } from "./SettingsUi.tsx";
import { useMachineSettings } from "./useMachineSettings.ts";

/** Settings → About & updates: the running versions of this app and of herdr, their updates, and where the project lives. */
export function AboutPage({ updates, herdrVersion }: { updates: UpdatesModel; herdrVersion: string | null }) {
  const t = useT();
  // an app update says whether remote PCs' bridges follow it
  const { pcSettings } = useMachineSettings();
  return (
    <SettingsGroup actions={<>
      <a className="btn btn-tertiary" href="https://github.com/devswha/herdr-web-ui" target="_blank" rel="noreferrer"><Star aria-hidden="true" />{t("Star on GitHub")}</a>
      <a className="btn btn-tertiary" href="https://devswha.github.io/herdr-web-ui/" target="_blank" rel="noreferrer"><Globe aria-hidden="true" />{t("Website")}</a>
    </>}>
      <UpdateControls updates={updates} bridgesFollow={pcSettings?.auto_update_bridges === true} />
      <HerdrUpdateControls enabled herdrVersion={herdrVersion} />
    </SettingsGroup>
  );
}
