import { useCallback, useEffect, useState } from "react";

import { machineRequest } from "../../lib/api.ts";
import type { MachineSettings } from "../../../shared/machines.ts";

/**
 * The server's PC preferences (the web server updates PC bridges, so it keeps this choice):
 * null until it answers, and when it cannot. Settings → Remote PCs switches them; About reads
 * whether bridges follow an app update.
 */
export function useMachineSettings() {
  const [pcSettings, setPcSettings] = useState<MachineSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    machineRequest<MachineSettings>("/settings").then((next) => { if (live) setPcSettings(next); }, () => { if (live) setPcSettings(null); });
    return () => { live = false; };
  }, []);
  const change = useCallback(async (patch: Partial<MachineSettings>) => {
    try { setPcSettings(await machineRequest<MachineSettings>("/settings", "PATCH", patch)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  return { pcSettings, error, change };
}
