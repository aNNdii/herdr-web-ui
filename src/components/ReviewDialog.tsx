import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Eye, GitBranch, PanelLeft, PanelLeftClose, X } from "lucide-react";

import "./ReviewDialog.css";
import { RenderBoundary } from "./RenderBoundary.tsx";
import { ReviewFile, ReviewLoading } from "./ReviewFile.tsx";
import { ReviewTree } from "./ReviewTree.tsx";

import type { RepoDiffFile, RepoDiffFileList, RepoDiffTree } from "../../shared/protocol.ts";
import { paneStorageId } from "../../shared/machines.ts";
import { useT } from "../lib/i18n.ts";
import { useMachineApi, useMachineId } from "../lib/machineContext.tsx";
import { diffErrorMessage, type RepoComparison } from "../lib/repoDiff.ts";
import { ApiError } from "../lib/api.ts";
import { storedShowIgnored, storedViewed, storeShowIgnored, storeViewed, treeMarks, type TreeMark, type ViewedFiles } from "../lib/review.ts";
import { SHEET_QUERY } from "../lib/sheets.ts";
import { nativeModalOver, useFocusTrap } from "../lib/useFocusTrap.ts";
import { useMediaQuery } from "../lib/useMediaQuery.ts";

export interface ReviewDialogProps {
  /** the pane whose folder's repository is reviewed; its comments go to the pane's chat */
  paneId: string;
  /** the pane's folder, read when the pane is gone */
  directory: string | null;
  /**
   * a file to show first: absolute, relative to the repository root or the pane's folder, or a bare name (a path a chat
   * names). In another repository the review shows that one; in none, the file alone, without the tree
   */
  initialPath?: string | null;
  onClose: () => void;
}

/** Where a path a chat names is: one file of the repository, a bare name several files have, or nowhere in it. */
type Resolved = { kind: "file"; path: string } | { kind: "several"; name: string } | { kind: "none" };

/**
 * Where a path a chat names is in the repository: a full path (absolute, or relative to the root),
 * or a bare file name as chats often write it, which matches when exactly one file has that name.
 * Several files of that name are left to the filter (`several`); none, or a path outside, is `none`.
 */
function resolveInRepository(rawPath: string, root: string, paths: readonly string[]): Resolved {
  // a chat writes a line behind the name (`bun.lock:11`): the file is what counts
  const path = rawPath.replace(/:\d+(:\d+)?$/, "");
  const base = root.replace(/[\\/]+$/, "");
  if (path.startsWith("/") || path.startsWith("~")) {
    if (!path.startsWith(`${base}/`)) return { kind: "none" };
    const relative = path.slice(base.length + 1);
    return paths.includes(relative) ? { kind: "file", path: relative } : { kind: "none" };
  }
  const relative = path.replace(/^\.\//, "");
  if (paths.includes(relative)) return { kind: "file", path: relative };
  const matches = paths.filter((candidate) => candidate === relative || candidate.endsWith(`/${relative}`));
  if (matches.length === 1) return { kind: "file", path: matches[0]! };
  if (matches.length > 1) return { kind: "several", name: relative };
  return { kind: "none" };
}

/** An answer still coming, failed, or there, for the folder (`base`) it was asked for. */
type Loaded<T> = ({ status: "pending" } | { status: "failed"; error: unknown } | { status: "ready"; value: T }) & { base: string | null };

/** A path without the line a chat writes behind it (`bun.lock:11`). */
function withoutLine(path: string): string {
  return path.replace(/:\d+(:\d+)?$/, "");
}

/** The line a path names behind its file (`src/App.tsx:28`), if any. */
function lineOf(path: string | null): number | null {
  const found = path === null ? null : /:(\d+)(?::\d+)?$/.exec(path);
  return found === null ? null : Number(found[1]);
}

/** The folder of an absolute path, and its last part. */
function folderOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, "") || "/";
}

function lastPart(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
}

/** Below this width in portrait the tree starts folded: a narrow screen shows the file, the tree on request. */
const NARROW_PORTRAIT = "(max-width: 1024px) and (orientation: portrait)";

/** Whether a listing failed because its folder is in no repository. */
function notRepository(error: unknown): boolean {
  return error instanceof ApiError && error.code === "not_a_repository";
}

/**
 * The repository's whole file tree on the left, the file shown on the right: a changed file opens as its diff (or its
 * whole text), an unchanged one as its text, each with its comments; a file the review cannot draw (media, or text too
 * large) in the file viewer's own view. The layout stays as it opens: the file is asked for at once and shown as soon
 * as its repository's changes say how (its diff or its text), while the tree loads on its own. A file of another
 * repository moves the review to that one; a file of none shows its folder's files instead of a repository's
 * (`plain`). On a phone the tree and the file take turns, with a Back button between them.
 */
export function ReviewDialog({ paneId, directory, initialPath = null, onClose }: ReviewDialogProps) {
  const t = useT();
  const machineId = useMachineId();
  const { fetchRepoDiffTree, fetchRepoDiffFiles, fetchFileInfo } = useMachineApi();
  const surface = useFocusTrap<HTMLElement>(true);
  const narrow = useMediaQuery(SHEET_QUERY);
  // the folder whose repository (or, in none, whose own files) the left side shows: the pane's, or a shown file's
  const [base, setBase] = useState(directory);
  const [tree, setTree] = useState<Loaded<RepoDiffTree>>({ status: "pending", base: directory });
  const [changeList, setChangeList] = useState<Loaded<RepoDiffFileList>>({ status: "pending", base: directory });
  // the file shown, by its absolute path; `decided` once its view is (opened by a path, it waits for its changes, so it
  // opens as its diff or its text and does not switch between them)
  const [file, setFile] = useState<string | null>(null);
  const [decided, setDecided] = useState<string | null>(null);
  // a path asked for and not found
  const [missing, setMissing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // the changed files are the default: a changed file shows its diff, "All files" shows whole files
  const [scope, setScope] = useState<"all" | "changed">("changed");
  // what the changes are compared with: the working tree (default), the index, or two revisions (`Branches`)
  const [compareWith, setCompareWith] = useState<RepoComparison>({ scope: "workspace", base: null, head: null });
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [treeShown, setTreeShown] = useState(() => !window.matchMedia(NARROW_PORTRAIT).matches);
  // the files git ignores, in All files: off until turned on (build output and dependencies are many), then kept per device
  const [showIgnored, setShowIgnored] = useState(storedShowIgnored);
  const [baseText, setBaseText] = useState("main");
  // Show changes with no base branch: the field says what is missing
  const [branchMissing, setBranchMissing] = useState(false);
  const [headText, setHeadText] = useState("");
  // the path to show (the opening's, then one a shown file links to), until it is found; one the server finds only
  // relative to the repository's root waits for the tree (`fallback`)
  const [wanted, setWanted] = useState(initialPath);
  // the line a path asked for (a comment's place): the file it is in opens whole, scrolled to it (`file` set once it is found)
  const [jump, setJump] = useState<{ line: number; file: string | null } | null>(() => {
    const line = lineOf(initialPath);
    return line === null ? null : { line, file: null };
  });
  const [fallback, setFallback] = useState<string | null>(null);

  // the tree: the repository's files whatever the changes are compared with, or a plain folder's; read for each folder
  // and again for the ignored files, the tree shown staying while they are read
  useEffect(() => {
    let live = true;
    setTree((old) => (old.status === "ready" && old.base === base ? old : { status: "pending", base }));
    fetchRepoDiffTree({ paneId, directory: base, ignored: showIgnored, folder: true }).then(
      (value) => { if (live) setTree({ status: "ready", value, base }); },
      (error: unknown) => { if (live) setTree({ status: "failed", error, base }); },
    );
    return () => { live = false; };
  }, [fetchRepoDiffTree, paneId, base, showIgnored]);

  // the changes, for each folder and comparison; the file shown stays
  useEffect(() => {
    let live = true;
    setChangeList({ status: "pending", base });
    fetchRepoDiffFiles({ paneId, directory: base, ...compareWith, stamps: true }).then(
      (value) => { if (live) setChangeList({ status: "ready", value, base }); },
      (error: unknown) => { if (live) setChangeList({ status: "failed", error, base }); },
    );
    return () => { live = false; };
  }, [fetchRepoDiffFiles, paneId, base, compareWith]);

  // the left side for `base`: the tree and the changes as far as they are there
  const treeNow = tree.base === base ? tree : { status: "pending" as const, base };
  const changesNow = changeList.base === base ? changeList : { status: "pending" as const, base };
  const treeValue = treeNow.status === "ready" ? treeNow.value : null;
  const changesValue = changesNow.status === "ready" ? changesNow.value : null;
  // a folder of no repository: its own files, no changes
  const plain = treeValue?.plain === true || (changesNow.status === "failed" && notRepository(changesNow.error));
  // the changes cannot be read (git failing, an old bridge): the file is shown all the same, as text
  const changesBroken = changesNow.status === "failed" && !plain;
  // the folder the left side starts at: the repository's root (the changes name it first), or a plain folder's
  const root = (plain ? treeValue?.repository.root ?? base : changesValue?.repository.root ?? treeValue?.repository.root) ?? null;
  const rootSlash = root === null ? null : `${root.replace(/[\\/]+$/, "")}/`;
  const inRoot = file !== null && rootSlash !== null && file.startsWith(rootSlash);
  // the shown file's path in the tree
  const selected = inRoot ? file!.slice(rootSlash!.length) : null;
  // where the shown file is drawn from: its repository or folder, or its own folder where the changes cannot say
  const fileRoot = file === null ? null : inRoot ? root : changesBroken ? folderOf(file) : null;
  // one list per answer: the tree and its marks are drawn again only when it changes
  const changes = useMemo(() => (plain ? [] : changesValue?.files ?? []), [plain, changesValue]);
  const change = selected === null ? null : changes.find((one) => one.path === selected) ?? null;
  // the changed files marked as viewed, per device and repository; a mark holds while the file's stamp is the one it was set at
  const [viewedMarks, setViewedMarks] = useState<ViewedFiles>({});
  useEffect(() => { setViewedMarks(root === null || plain ? {} : storedViewed(machineId, root)); }, [machineId, root, plain]);
  const viewedPaths = useMemo(() => new Set(changes.filter((one) => one.stamp !== undefined && viewedMarks[one.path] === one.stamp).map((one) => one.path)), [changes, viewedMarks]);
  const setViewed = (one: RepoDiffFile, on: boolean): void => {
    if (root === null || one.stamp === undefined) return;
    setViewedMarks(storeViewed(machineId, root, viewedMarks, one.path, on ? one.stamp : null));
  };


  // a path to show is asked of the server at once, as the file viewer asks (absolute, `~/`, relative to the pane's
  // folder, or a bare name found under it): no waiting for the tree. A name several files end in fills the filter
  useEffect(() => {
    const path = wanted;
    if (path === null) return;
    let live = true;
    const asked = withoutLine(path);
    fetchFileInfo(asked, paneId).then(
      (info) => {
        if (!live) return;
        setWanted(null);
        setMissing(null);
        if ("candidates" in info) {
          setQuery(lastPart(asked));
          setScope("all");
          return;
        }
        setFile(info.path);
        setDecided(null);
        setJump((asked) => (asked === null || asked.file !== null ? asked : { ...asked, file: info.path }));
      },
      (error: unknown) => {
        if (!live) return;
        setWanted(null);
        setFallback(asked);
      },
    );
    return () => { live = false; };
  }, [wanted, fetchFileInfo, paneId]);

  // a path the server did not find from the pane's folder: relative to the repository's root, or a name the tree has
  useEffect(() => {
    if (fallback === null || treeNow.status === "pending") return;
    setFallback(null);
    const found = treeValue === null || root === null ? { kind: "none" as const } : resolveInRepository(fallback, root, treeValue.paths);
    if (found.kind === "file") {
      setFile(`${rootSlash}${found.path}`);
      setDecided(null);
      setJump((asked) => (asked === null || asked.file !== null ? asked : { ...asked, file: `${rootSlash}${found.path}` }));
    } else if (found.kind === "several") {
      setQuery(found.name);
      setScope("all");
    } else setMissing(fallback);
  }, [fallback, treeNow.status, treeValue, root, rootSlash]);

  // a file outside the folder shown moves the left side to its folder: its repository, or its folder's own files
  useEffect(() => {
    if (file === null || inRoot || changesBroken) return;
    // the folder shown is still being read: the file waits for it
    if (root === null && changesNow.status === "pending" && treeNow.status === "pending") return;
    if (!plain && changesNow.status === "pending") return;
    setQuery("");
    setBase(folderOf(file));
  }, [file, inRoot, changesBroken, root, plain, changesNow.status, treeNow.status]);

  // a file opened by a path shows as its diff when it changed, else as its whole text: decided once its changes are
  // there, so it does not switch from one to the other
  useEffect(() => {
    if (file === null || fileRoot === null || decided === file) return;
    if (!plain && !changesBroken && changesValue === null) return;
    setDecided(file);
    // asked for a line (a comment's): the whole file, where every line is, not its diff
    if (!plain) setScope(change !== null && jump?.file !== file ? "changed" : "all");
  }, [file, fileRoot, decided, plain, changesBroken, changesValue, change, jump]);

  // a file picked in the tree opens in the list it was picked from, as it is
  const pick = (relative: string): void => {
    if (rootSlash === null) return;
    const path = `${rootSlash}${relative}`;
    // the tree selecting the file already shown (it marks it as it loads) is no new pick
    if (path === file) return;
    setMissing(null);
    setFile(path);
    setDecided(path);
  };
  const openPath = (path: string): void => {
    setWanted(path);
    const line = lineOf(path);
    setJump(line === null ? null : { line, file: null });
  };
  const closeFile = (): void => {
    setFile(null);
    setDecided(null);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !nativeModalOver(surface.current)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, surface]);

  const filter = query.trim().toLowerCase();
  const changedPaths = useMemo(() => new Set(changes.map((one) => one.path)), [changes]);
  // the list the tree shows: all of the repository's (or the folder's) files, or only those git lists as changed; then the filter
  const listShown = plain ? "all" : scope;
  const listing = listShown === "changed" ? changesNow : treeNow;
  const shownPaths = useMemo(() => {
    // Changed lists git's changes themselves: a file staged for deletion, or one a compared revision dropped, is not in the tree's files
    let list = listShown === "changed" ? [...changedPaths] : treeValue?.paths ?? [];
    if (filter !== "") list = list.filter((path) => path.toLowerCase().includes(filter));
    return list;
  }, [treeValue, listShown, changedPaths, filter]);
  const ignoredPaths = plain ? undefined : treeValue?.ignored;
  const marks = useMemo<TreeMark[]>(() => [...treeMarks(changes), ...(ignoredPaths ?? []).map((path) => ({ path, status: "ignored" as const }))], [changes, ignoredPaths]);
  const listReady = listing.status === "ready";
  // a file of the repository git ignores: not among its listed files (or among those listed as ignored)
  const listedPaths = useMemo(() => new Set(treeValue?.paths ?? []), [treeValue]);
  const ignoredFile = !plain && treeValue !== null && selected !== null && change === null
    && (treeValue.ignored?.includes(selected) === true || !listedPaths.has(selected));
  // where the repository stands: its branch (a detached HEAD's commit), or the two revisions compared
  const repository = plain ? null : changesValue?.repository ?? treeValue?.repository ?? null;
  const where = compareWith.scope === "commit" && compareWith.base !== null ? `${compareWith.base}…${compareWith.head ?? "HEAD"}`
    : repository === null ? null : repository.branch ?? repository.head?.slice(0, 7) ?? null;
  const truncated = (treeValue?.truncated ?? false) || (changesValue?.truncated ?? false);
  const showFile = narrow && file !== null;
  // with no file chosen the tree shows, whatever it was folded to: else a narrow screen would show nothing
  const treeVisible = treeShown || file === null;
  // the title: the repository's folder, or the plain folder's
  const title = root !== null ? lastPart(root) : t("Review");

  return (
    <div className="modal-scrim review-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal review-dialog" role="dialog" aria-modal="true" aria-label={t("Review")} ref={surface} tabIndex={-1} data-view={showFile ? "file" : "tree"} data-tree={treeVisible ? "shown" : "folded"}>
        <header className="modal-header review-header">
          <button type="button" className="icon-button review-fold" aria-pressed={!treeVisible} aria-label={treeVisible ? t("Hide files") : t("Show files")} title={treeVisible ? t("Hide files") : t("Show files")} onClick={() => setTreeShown(!treeVisible)}>
            {treeVisible ? <PanelLeftClose aria-hidden="true" /> : <PanelLeft aria-hidden="true" />}
          </button>
          {showFile && <button type="button" className="icon-button review-back" aria-label={t("Files")} title={t("Files")} onClick={closeFile}>
            <ArrowLeft aria-hidden="true" />
          </button>}
          {/* where the review is: the repository, and under it its branch (or the revisions compared); a plain folder by
              its name, and under it where it lies (its parent's path, cut at the end) */}
          <div className="review-title">
            <h2 className="modal-title" title={root ?? undefined}>{title}</h2>
            <p className="review-meta">
              {plain && root !== null && <span className="review-meta-path" dir="ltr" title={root}>{folderOf(root)}</span>}
              {where !== null && <span className="review-meta-branch"><GitBranch aria-hidden="true" />{where}</span>}
              {truncated && <span className="review-meta-warning">{t("The list is cut short.")}</span>}
            </p>
          </div>
          <button type="button" className="icon-button review-close" aria-label={t("Close review")} title={t("Close review")} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="review-body">
          <div className="review-tree-pane">
            {!plain && <div className="segmented review-scope" role="group" aria-label={t("Files shown")}>
              <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>{t("All files")}</button>
              {/* the changed files' count on their button (with Viewed marks: how many of them are viewed) */}
              <button type="button" aria-pressed={scope === "changed"} onClick={() => setScope("changed")}>
                {t("Changed files")}
                {changesValue !== null && <span className="review-badge" aria-label={viewedPaths.size > 0 ? t("{viewed} of {count} viewed", { viewed: viewedPaths.size, count: changes.length }) : t("{count} changed", { count: changes.length })}>
                  {viewedPaths.size > 0 ? `${viewedPaths.size}/${changes.length}` : changes.length}
                </span>}
              </button>
            </div>}
            {/* what the changes are compared with: under Changed, the list it decides */}
            {!plain && scope === "changed" && <div className="review-compare">
              <div className="segmented review-scope" role="group" aria-label={t("Compare")}>
                <button type="button" aria-pressed={!branchesOpen && compareWith.scope === "workspace"} onClick={() => { setBranchesOpen(false); setCompareWith({ scope: "workspace", base: null, head: null }); }}>{t("Working tree")}</button>
                <button type="button" aria-pressed={!branchesOpen && compareWith.scope === "staged"} onClick={() => { setBranchesOpen(false); setCompareWith({ scope: "staged", base: null, head: null }); }}>{t("Staged")}</button>
                <button type="button" aria-pressed={branchesOpen || compareWith.scope === "commit"} onClick={() => setBranchesOpen(true)}>{t("Branches")}</button>
              </div>
              {branchesOpen && <form className="review-branches" noValidate onSubmit={(event) => {
                event.preventDefault();
                if (baseText.trim() === "") {
                  setBranchMissing(true);
                  return;
                }
                setBranchMissing(false);
                setCompareWith({ scope: "commit", base: baseText.trim(), head: headText.trim() === "" ? null : headText.trim() });
              }}>
                <label className="field">
                  <span className="field-label">{t("Base branch")}</span>
                  <input className="input" value={baseText} onChange={(event) => { setBaseText(event.target.value); setBranchMissing(false); }} placeholder="main" aria-invalid={branchMissing} autoComplete="off" spellCheck={false} />
                  {branchMissing && <span className="field-hint review-field-error" role="alert">{t("Enter a base branch.")}</span>}
                </label>
                <label className="field">
                  <span className="field-label">{t("Branch")}</span>
                  <input className="input" value={headText} onChange={(event) => setHeadText(event.target.value)} placeholder="HEAD" autoComplete="off" spellCheck={false} />
                  <span className="field-hint">{t("HEAD when empty")}</span>
                </label>
                <button type="submit" className="btn btn-primary">{t("Show changes")}</button>
              </form>}
            </div>}
            <div className="review-filter">
              <input type="search" className="input review-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Filter files")} aria-label={t("Filter files")} spellCheck={false} />
              {!plain && scope === "all" && <button type="button" className="icon-button repo-diff-action review-ignored" aria-pressed={showIgnored} aria-label={t("Show ignored files")} title={t("Show ignored files")} onClick={() => { storeShowIgnored(!showIgnored); setShowIgnored(!showIgnored); }}>
                <Eye aria-hidden="true" />
              </button>}
            </div>
            {/* the tree loads on its own: its place holds a loader meanwhile, the file beside it is shown already */}
            {listing.status === "pending" && <ReviewLoading />}
            {listing.status === "failed" && <p className="repo-diff-note" role="alert">{diffErrorMessage(t, listing.error)}</p>}
            {listReady && shownPaths.length === 0 && <p className="repo-diff-note">{listShown === "changed" && filter === "" ? t("Nothing changed here.") : t("No file matches.")}</p>}
            {/* a tree the library cannot build (a listing it refuses) is a note here: the rest of the review stays usable */}
            {listReady && shownPaths.length > 0 && <RenderBoundary resetKey={shownPaths} fallback={() => <p className="repo-diff-note" role="alert">{t("The file list can't be shown.")}</p>}>
              <ReviewTree paths={shownPaths} marks={marks} selected={selected} expandAll={filter !== "" || listShown === "changed"} viewed={viewedPaths} viewedTitle={t("Viewed")} onOpen={pick} />
            </RenderBoundary>}
          </div>
          <div className="review-file-pane">
            {file !== null && fileRoot !== null && decided === file
              ? <RenderBoundary resetKey={file} fallback={() => <p className="repo-diff-note" role="alert">{t("This file can't be shown.")}</p>}>
                <ReviewFile key={file} owner={paneStorageId(machineId, paneId)} paneId={paneId} directory={base} root={fileRoot} path={file.slice(fileRoot.replace(/[\\/]+$/, "").length + 1)} change={plain ? null : change} plain={plain} ignored={ignoredFile}
                  viewed={plain || change === null || change.stamp === undefined ? null : viewedPaths.has(change.path)} onViewed={(on) => { if (change !== null) setViewed(change, on); }} diffMode={!plain && scope === "changed"} comparison={compareWith} line={jump !== null && jump.file === file ? jump.line : undefined} onClose={closeFile} onOpen={openPath} />
              </RenderBoundary>
              : file !== null || wanted !== null || fallback !== null ? <ReviewLoading />
              : missing !== null ? <p className="repo-diff-note" role="alert">{t("This file can't be shown.")}</p>
              : <p className="repo-diff-note">{t("Choose a file in the tree.")}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
