import { afterEach, expect, it } from "bun:test";
import { MAX_ATTACHMENT_BYTES } from "../../shared/attachments.ts";
import { NOTICE_VERSION } from "../../shared/telemetry.ts";
import { AttachmentTooLargeError, ApiError, changeTelemetry, fetchPaneSubagents, fetchRepoBranches, fetchRepoDiffFile, fetchRepoDiffFiles, fetchTelemetry, uploadPaneImage } from "./api.ts";
import { DEFAULT_SETTINGS, telemetrySettingsSnapshot } from "./settings.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

it("refuses a file over the attachment limit before any of it is sent, and sends one at the limit", async () => {
  const requests: string[] = [];
  globalThis.fetch = (async (url: string) => {
    requests.push(url);
    return Response.json({ ok: true, path: "/work/.herdr-web-ui/site.zip" });
  }) as typeof fetch;

  const over = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "site.zip", { type: "application/zip" });
  const refused = await uploadPaneImage("p1", over).catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(AttachmentTooLargeError);
  expect(refused).toMatchObject({ fileName: "site.zip", size: MAX_ATTACHMENT_BYTES + 1 });
  expect(requests).toEqual([]);

  const atLimit = new File([new Uint8Array(MAX_ATTACHMENT_BYTES)], "site.zip", { type: "application/zip" });
  expect(await uploadPaneImage("p1", atLimit)).toBe("/work/.herdr-web-ui/site.zip");
  expect(requests).toEqual(["/api/pane/image"]);
});

it("refuses a 40 MiB file in the browser with the 32 MB limit named, before upload (regression: 8 MB limit on main)", async () => {
  globalThis.fetch = (async (): Promise<Response> => { throw new Error("must not upload"); }) as unknown as typeof fetch;
  const refused = await uploadPaneImage("p1", new File([new Uint8Array(40 * 1024 * 1024)], "big.zip", { type: "application/zip" })).catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(AttachmentTooLargeError);
  expect((refused as Error).message).toContain("32 MB");
  expect(MAX_ATTACHMENT_BYTES).toBe(32 * 1024 * 1024);
});

it("posts the full safe telemetry snapshot and current notice version", async () => {
  const settings = telemetrySettingsSnapshot({
    ...DEFAULT_SETTINGS,
    terminalFontFamily: "Private Font Name",
    chatFontFamily: "Private Chat Font",
    usageHidden: ["account-identifier"],
  });
  const change = { notice_seen: true as const, notice_version: NOTICE_VERSION, settings };
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requestUrl = url;
    requestInit = init;
    return Response.json({ enabled: true, blocked_by_env: false, notice_seen: true, next: null });
  }) as typeof fetch;

  await changeTelemetry(change);

  expect(requestUrl).toBe("/api/telemetry");
  expect(requestInit?.method).toBe("POST");
  expect(requestInit?.headers).toEqual({ "content-type": "application/json", "x-herdr-update": "1" });
  const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
  expect(body).toEqual(change);
  expect(body).not.toHaveProperty("changed_settings");
  expect(Object.keys(body.settings as object)).toHaveLength(50);
  expect(body.settings).toHaveProperty("darkTheme", "codex");
  expect(body.settings).toHaveProperty("lightTheme", "codex");
  expect(body.settings).toHaveProperty("statusIndicators", "classic");
  expect(body.settings).not.toHaveProperty("terminalFontFamily");
  expect(body.settings).not.toHaveProperty("chatFontFamily");
  expect(body.settings).not.toHaveProperty("usageHidden");
  expect((body.settings as Record<string, unknown>).terminalFontCustom).toBe(true);
  expect((body.settings as Record<string, unknown>).usageHiddenCount).toBe(1);
});

it("preserves telemetry API errors", async () => {
  globalThis.fetch = (async (_url: string) => Response.json({ error: { code: "telemetry_failed", message: "Could not save" } }, { status: 500 })) as typeof fetch;

  const error = await changeTelemetry({ enabled: false }).catch((failure: unknown) => failure);

  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status: 500, code: "telemetry_failed", detail: "Could not save" });
});

it("keeps the field an error names in param, and null when the server names none", async () => {
  globalThis.fetch = (async (_url: string) => Response.json({ error: { code: "revision_not_found", message: "no such revision", param: "head" } }, { status: 404 })) as typeof fetch;
  const named = await fetchRepoDiffFiles({ paneId: "w1:p1", directory: null, scope: "commit", base: "main", head: "feat/x" }).catch((failure: unknown) => failure);
  expect(named).toBeInstanceOf(ApiError);
  expect(named).toMatchObject({ status: 404, code: "revision_not_found", param: "head" });

  globalThis.fetch = (async (_url: string) => Response.json({ error: { code: "telemetry_failed", message: "Could not save" } }, { status: 500 })) as typeof fetch;
  expect(await changeTelemetry({ enabled: false }).catch((failure: unknown) => failure)).toMatchObject({ code: "telemetry_failed", param: null });

  globalThis.fetch = (async (_url: string) => new Response("gateway down", { status: 502, statusText: "Bad Gateway" })) as typeof fetch;
  expect(await changeTelemetry({ enabled: false }).catch((failure: unknown) => failure)).toMatchObject({ code: null, param: null });
});

it("asks for the merge base only in a commit comparison", async () => {
  const requests: string[] = [];
  globalThis.fetch = (async (url: string) => {
    requests.push(url);
    return Response.json({});
  }) as typeof fetch;
  await fetchRepoDiffFiles({ paneId: "w1:p1", directory: null, scope: "commit", base: "origin/next", head: "feat/x", mergeBase: true });
  await fetchRepoDiffFile({ paneId: "w1:p1", directory: null, scope: "commit", base: "origin/next", head: "feat/x", mergeBase: true }, "src/a.ts", null, "pc-2");
  await fetchRepoDiffFiles({ paneId: "w1:p1", directory: null, scope: "workspace", base: null, head: null, mergeBase: true });
  await fetchRepoDiffFiles({ paneId: "w1:p1", directory: null, scope: "commit", base: "abc", head: "def", mergeBase: false });
  await fetchRepoDiffFiles({ paneId: "w1:p1", directory: null, scope: "commit", base: "abc", head: "def" });
  const mergeBases = requests.map((url) => new URL(url, "http://x").searchParams.get("merge_base"));
  expect(mergeBases).toEqual(["1", "1", null, null, null]);
  expect(requests[0]).toBe("/api/workspace/diff/files?pane_id=w1%3Ap1&scope=commit&base=origin%2Fnext&head=feat%2Fx&merge_base=1");
  expect(requests[1]).toStartWith("/api/machines/pc-2/workspace/diff/file?");
});

it("reads a repository's branches through the PC's path, by pane or by folder", async () => {
  const requests: string[] = [];
  const list = { repository: { root: "/work", branch: "main", head: "a".repeat(40), detached: false, unborn: false }, branches: [{ name: "main", remote: false, worktree: "/work" }], default_base: "main", truncated: false, limits: { max_branches: 1000 } };
  globalThis.fetch = (async (url: string) => {
    requests.push(url);
    return Response.json(list);
  }) as typeof fetch;
  expect(await fetchRepoBranches({ paneId: "w1:p1", directory: null })).toEqual(list);
  await fetchRepoBranches({ paneId: null, directory: "/work/sub" }, "pc-2");
  expect(requests).toEqual(["/api/workspace/diff/branches?pane_id=w1%3Ap1", "/api/machines/pc-2/workspace/diff/branches?directory=%2Fwork%2Fsub"]);

  globalThis.fetch = (async (_url: string) => Response.json({ error: { code: "read_only", message: "this device can only watch" } }, { status: 403 })) as typeof fetch;
  expect(await fetchRepoBranches({ paneId: "w1:p1", directory: null }).catch((failure: unknown) => failure)).toMatchObject({ status: 403, code: "read_only" });
});

it("treats a missing telemetry route as unavailable for reads and an API error for writes", async () => {
  globalThis.fetch = (async (_url: string) => Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 })) as typeof fetch;

  expect(await fetchTelemetry()).toBeNull();
  const error = await changeTelemetry({ enabled: true }).catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status: 404, code: "not_found" });
});

it("reads a pane's subagents through the PC's path, and an older bridge without the route as none", async () => {
  const requests: string[] = [];
  globalThis.fetch = (async (url: string) => {
    requests.push(url);
    return Response.json({ subagents: [{ handle: "explore", description: "Fast codebase exploration" }] });
  }) as typeof fetch;
  expect(await fetchPaneSubagents("w1:p1")).toEqual([{ handle: "explore", description: "Fast codebase exploration" }]);
  expect(await fetchPaneSubagents("w1:p1", "pc-2")).toHaveLength(1);
  expect(requests).toEqual(["/api/pane/subagents?pane_id=w1%3Ap1", "/api/machines/pc-2/pane/subagents?pane_id=w1%3Ap1"]);

  globalThis.fetch = (async (_url: string) => Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 })) as typeof fetch;
  expect(await fetchPaneSubagents("w1:p1", "pc-2")).toEqual([]);

  globalThis.fetch = (async (_url: string) => Response.json({ error: { code: "pane_not_found", message: "pane not found" } }, { status: 404 })) as typeof fetch;
  expect(await fetchPaneSubagents("w1:p1").catch((failure: unknown) => failure)).toMatchObject({ status: 404, code: "pane_not_found" });
});
