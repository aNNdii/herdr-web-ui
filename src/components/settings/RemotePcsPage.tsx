import { useCallback, useState } from "react";
import { Check, Download, Monitor, MoreHorizontal, Pencil, Plus, Power, RefreshCw, Trash2, X } from "lucide-react";

import { machineRequest } from "../../lib/api.ts";
import { useT } from "../../lib/i18n.ts";
import type { Machine } from "../../../shared/machines.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { STATE_WORD } from "../MachineSidebar.tsx";
import { RowMenu } from "../RowMenu.tsx";
import { ServerTag, SettingsGroup, SettingsRow, SettingsTag, Toggle } from "./SettingsUi.tsx";
import { useMachineSettings } from "./useMachineSettings.ts";

export interface RemotePcsProps {
  /** App's roster, the sidebar's PC groups */
  machines: Machine[];
  /** the PC setup dialog (actions.openAddPc): Settings closes behind it */
  onAddPc: () => void;
  /** a PC's own setup dialog, as its sidebar group opens it: reconnect, or update its bridge */
  onSetup: (machine: Machine, update?: boolean) => void;
  /** a PC was removed: the selection moves off it, as the sidebar does */
  onRemoved: (machineId: string) => void;
}

/**
 * Settings → Remote PCs: the PCs, each with the actions its sidebar group's manage button has,
 * Add PC, and the server's bridge update switch. Add PC never waits for the server's settings.
 */
export function RemotePcsPage({ machines, onAddPc, onSetup, onRemoved }: RemotePcsProps) {
  const t = useT();
  const { pcSettings, error, change } = useMachineSettings();
  const [menu, setMenu] = useState<{ anchor: HTMLElement; machine: Machine } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<Machine | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const mutate = async (machine: Machine, method: string, body?: unknown): Promise<boolean> => {
    try { await machineRequest(`/${machine.id}`, method, body); setRowError(null); return true; }
    catch (e) { setRowError({ id: machine.id, message: e instanceof Error ? e.message : String(e) }); return false; }
  };

  return (
    <>
      <SettingsGroup actions={<button type="button" className="btn btn-primary" onClick={onAddPc}><Plus aria-hidden="true" />{t("Add PC")}</button>}>
        {machines.length === 0 && <SettingsRow keywords="remote pc"><p className="settings-note" role="status">{t("Loading PCs…")}</p></SettingsRow>}
        {machines.map((machine) => {
          const notice = machine.updating ? t("Updating the bridge") : machine.action_required === "update_bridge" ? t("Bridge update needed") : machine.action_required === "setup" ? t("Setup needed") : null;
          const error = rowError?.id === machine.id ? rowError.message : null;
          if (renaming?.id === machine.id) {
            return (
              <SettingsRow key={machine.id} keywords={`remote pc rename ${machine.name}`} stack control={
                <form className="settings-field-row" onSubmit={(e) => { e.preventDefault(); void mutate(machine, "PATCH", { name: renaming.name }).then((ok) => { if (ok) setRenaming(null); }); }}>
                  <input className="input" value={renaming.name} maxLength={100} autoFocus aria-label={t("PC name")} onChange={(e) => setRenaming({ id: machine.id, name: e.target.value })} />
                  <button type="submit" className="icon-button" aria-label={t("Save name")}><Check /></button>
                  <button type="button" className="icon-button" aria-label={t("Cancel")} onClick={() => setRenaming(null)}><X /></button>
                </form>
              }>
                {error && <p className="settings-note is-error" role="alert">{error}</p>}
              </SettingsRow>
            );
          }
          return (
            <SettingsRow key={machine.id} icon={<Monitor />} label={machine.name}
              tag={<>
                {machine.kind === "local" && <SettingsTag>{t("Host")}</SettingsTag>}
                <SettingsTag tone={machine.state === "connected" ? "ok" : undefined}>{t(STATE_WORD[machine.state])}</SettingsTag>
              </>}
              description={machine.kind === "ssh" ? machine.target?.destination : t("The computer this app runs on")}
              keywords={`remote pc ssh ${machine.kind === "local" ? "host local" : ""} ${STATE_WORD[machine.state]}`}
              control={machine.kind === "ssh" ? (
                <button type="button" className="icon-button" aria-label={t("Manage {name}", { name: machine.name })} aria-haspopup="menu" aria-expanded={menu?.machine.id === machine.id}
                  onClick={(event) => setMenu(menu?.machine.id === machine.id ? null : { anchor: event.currentTarget, machine })}>
                  <MoreHorizontal aria-hidden="true" />
                </button>
              ) : undefined}>
              {notice && <p className="settings-note">{notice}</p>}
              {machine.error && machine.state !== "connected" && <p className="settings-note is-error">{machine.error}</p>}
              {error && <p className="settings-note is-error" role="alert">{error}</p>}
            </SettingsRow>
          );
        })}
      </SettingsGroup>
      {/* the switch is the server's and waits for its answer; Add PC never does */}
      {(pcSettings || error) && (
        <SettingsGroup title={t("Bridges")} tag={<ServerTag />}>
          {pcSettings && (
            <SettingsRow label={t("Update PC bridges automatically")} description={t("When an app update needs a newer bridge, PCs that connect with their saved key are updated in the background. PCs that need a password ask first.")} keywords="update pc bridges automatically remote ssh" control={
              <Toggle label={t("Update PC bridges automatically")} checked={pcSettings.auto_update_bridges} onChange={(auto_update_bridges) => void change({ auto_update_bridges })} />
            } />
          )}
          {error && <SettingsRow keywords="update pc bridges"><p className="settings-note is-error" role="alert">{error}</p></SettingsRow>}
        </SettingsGroup>
      )}
      {menu && (
        <RowMenu anchor={menu.anchor} title={menu.machine.name} onClose={closeMenu} items={[
          { id: "rename", label: t("Rename"), icon: Pencil, run: () => setRenaming({ id: menu.machine.id, name: menu.machine.name }) },
          { id: "enabled", label: t(menu.machine.enabled ? "Disconnect" : "Connect"), icon: Power, run: () => void mutate(menu.machine, "PATCH", { enabled: !menu.machine.enabled }) },
          { id: "setup", label: t("Reconnect / setup"), icon: RefreshCw, run: () => onSetup(menu.machine) },
          { id: "update", label: t("Update bridge…"), icon: Download, run: () => onSetup(menu.machine, true) },
          { id: "remove", label: t("Remove PC"), icon: Trash2, danger: true, divider: true, run: () => setRemoving(menu.machine) },
        ]} />
      )}
      {removing && (
        <ConfirmDialog title={t("Remove {name}?", { name: removing.name })} body={t("Removes this registration. Remote sessions keep running.")} confirmLabel={t("Remove PC")}
          onConfirm={async () => { await machineRequest(`/${removing.id}`, "DELETE"); onRemoved(removing.id); setRemoving(null); }} onClose={() => setRemoving(null)} />
      )}
    </>
  );
}
