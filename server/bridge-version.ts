/**
 * fork: the bridge version this server installs on a remote PC and expects back from it.
 *
 * Upstream raises REMOTE_BUNDLE_VERSION (shared/machines.ts) by hand whenever the bundle's inputs
 * change; the fork changes server/ and shared/ without touching it, so a PC would keep a bridge of
 * the same number but older code. The fork's version is upstream's number and a fingerprint of what
 * the bundle runs: every file of server/ and shared/ that scripts/build-remote-bundle.ts copies
 * (all but `*.test.ts`), path and bytes. The connection server reads them from its checkout, a bridge
 * from its bundle, so both name the same version exactly when they run the same code, and a fork
 * release with other server code installs its own bridge on every PC (`.github/workflows/
 * fork-bridge-bundles.yml` publishes it as `remote-v<version>` in this fork).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REMOTE_BUNDLE_VERSION as UPSTREAM_BUNDLE_VERSION } from "../shared/machines.ts";

/** The files of `directory` the bundle carries, as `/`-separated paths under `root`, sorted. */
function bundled(root: string, directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...bundled(root, path));
    else if (entry.isFile() && !entry.name.endsWith(".test.ts")) found.push(path);
  }
  return found;
}

/** 12 hex digits of the sha256 over the bundled server/ and shared/ files under `root`. */
export function bridgeFingerprint(root: string): string {
  const hash = createHash("sha256");
  for (const path of [...bundled(root, "server"), ...bundled(root, "shared")].sort()) {
    hash.update(path).update("\0").update(readFileSync(join(root, path))).update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}

/** `30-fork.<fingerprint>`: upstream's number first, so a raised upstream version shows in it. */
export const BRIDGE_VERSION = `${UPSTREAM_BUNDLE_VERSION}-fork.${bridgeFingerprint(join(import.meta.dir, ".."))}`;
