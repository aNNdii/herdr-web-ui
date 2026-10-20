import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, PanelLeft, PanelLeftClose, X } from "lucide-react";

import "./ReviewDialog.css";
import { ComparePicker } from "./ComparePicker.tsx";
import { RenderBoundary } from "./RenderBoundary.tsx";
import { ReviewFile, ReviewLoading } from "./ReviewFile.tsx";
import { ReviewOptions, type ReviewOption } from "./ReviewOptions.tsx";
import { ReviewTree } from "./ReviewTree.tsx";
import { ReviewTreeResizer } from "./ReviewTreeResizer.tsx";

import type { RepoBranchList, RepoDiffFile, RepoDiffFileList, RepoDiffTree } from "../../shared/protocol.ts";
import { paneStorageId } from "../../shared/machines.ts";
import { useT } from "../lib/i18n.ts";
import { useMachineApi, useMachineId } from "../lib/machineContext.tsx";
import { diffErrorMessage, nothingChangedSentence, refusedUncommitted, standInMessage, worktreeMovedMessage } from "../lib/repoDiff.ts";
import { ApiError, routeMissing } from "../lib/api.ts";
import { branchChoices, branchDefaults, branchFieldError, reviewAsk, reviewComparison, worktreeOf, type BranchPick, type ReviewAsk, type ReviewChoice } from "../lib/branchReview.ts";
import { storedHideViewed, storedNewFilesApart, storedShowIgnored, storedViewed, storeHideViewed, storeNewFilesApart, storeShowIgnored, storeViewed, treeMarks, type TreeMark, type ViewedFiles } from "../lib/review.ts";
import { drawnRows, reviewList, type ReviewListNote } from "../lib/reviewList.ts";
import { reviewTreeColumn, storedReviewTreeWidth } from "../lib/reviewTreeWidth.ts";
import { SHEET_QUERY } from "../lib/sheets.ts";
import { useAnnouncedText } from "../lib/useAnnouncedText.ts";
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

/** An answer still coming, failed, or there, for the folder it was asked for. */
type Loaded<T> = ({ status: "pending" } | { status: "failed"; error: unknown } | { status: "ready"; value: T }) & { folder: string | null };

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
 *
 * What is compared is the line under the title (ComparePicker): Uncommitted, Staged, or two branches, each part opening
 * its picker under itself. Under Branches, a compare branch checked out in a worktree is read there with what is not
 * committed in it (Show uncommitted changes in View options, on by default): the whole review reads that folder, and its
 * comments still go to the pane. A worktree that turned out to have another branch checked out, or a bridge from before
 * `uncommitted`, gets the comparison without it and a calm note under the line.
 */
export function ReviewDialog({ paneId, directory, initialPath = null, onClose }: ReviewDialogProps) {
  const t = useT();
  const machineId = useMachineId();
  const { fetchRepoDiffTree, fetchRepoDiffFiles, fetchRepoBranches, fetchFileInfo } = useMachineApi();
  const surface = useFocusTrap<HTMLElement>(true);
  const narrow = useMediaQuery(SHEET_QUERY);
  // the refused comparison's words under the line, which its part names as its description
  const refusalId = useId();
  // the folder whose repository (or, in none, whose own files) the left side shows: the pane's, or a shown file's
  const [base, setBase] = useState(directory);
  const [tree, setTree] = useState<Loaded<RepoDiffTree>>({ status: "pending", folder: directory });
  // the changes, for the folder and the ask they were asked with
  const [changeList, setChangeList] = useState<Loaded<RepoDiffFileList> & { ask: ReviewAsk | null }>({ status: "pending", folder: directory, ask: null });
  // the repository's branches the branch fields offer, read once per folder when Branches opens, and again (`refsRound`)
  // when a worktree turned out to have another branch checked out than the list said
  const [refs, setRefs] = useState<Loaded<RepoBranchList> | null>(null);
  const refsAsked = useRef<string | undefined>(undefined);
  const [refsRound, setRefsRound] = useState(0);
  // the file shown, by its absolute path; `decided` once its view is (opened by a path, it waits for its changes, so it
  // opens as its diff or its text and does not switch between them)
  const [file, setFile] = useState<string | null>(null);
  const [decided, setDecided] = useState<string | null>(null);
  // a path asked for and not found
  const [missing, setMissing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // the changed files are the default: a changed file shows its diff, "All files" shows whole files
  const [scope, setScope] = useState<"all" | "changed">("changed");
  // what the changes are compared with: everything uncommitted (default), the index, or two branches (`Branches`)
  const [tip, setTip] = useState<"uncommitted" | "staged">("uncommitted");
  const [branchesOpen, setBranchesOpen] = useState(false);
  // a picker showed the branch list: it is read from then on, before Branches is compared
  const [listWanted, setListWanted] = useState(false);
  // the branch fields as chosen; a field not chosen keeps its default
  const [branchPick, setBranchPick] = useState<Partial<BranchPick> | null>(null);
  // how often a branch was chosen: each choice resolves its names again, the same ones too (new commits since)
  const [branchAsks, setBranchAsks] = useState(0);
  const chooseBranches = (pick: Partial<BranchPick>): void => { setBranchPick((old) => ({ ...old, ...pick })); setBranchAsks((asks) => asks + 1); setMoved(null); };
  const chooseTip = (next: "uncommitted" | "staged"): void => { setBranchesOpen(false); setTip(next); };
  const chooseBranch = (part: "compare" | "base", name: string): void => { setBranchesOpen(true); chooseBranches(part === "compare" ? { compare: name } : { base: name }); };
  // under Branches, whether compare's worktree is read with its uncommitted changes (where it has one)
  const [includeUncommitted, setIncludeUncommitted] = useState(true);
  // the branch whose worktree had another branch checked out when its changes were asked; a choice of a branch asks again
  const [moved, setMoved] = useState<string | null>(null);
  // this PC's bridge refused `uncommitted` as an unknown scope: its stand-ins are asked for as long as the review is open
  const [olderBridge, setOlderBridge] = useState(false);
  const [treeShown, setTreeShown] = useState(() => !window.matchMedia(NARROW_PORTRAIT).matches);
  // the files git ignores, in All files: off until turned on (build output and dependencies are many), then kept per device
  const [showIgnored, setShowIgnored] = useState(storedShowIgnored);
  // the viewed files, in Changed files: shown until hidden, then kept hidden per device
  const [hideViewed, setHideViewed] = useState(storedHideViewed);
  const chooseHideViewed = (on: boolean): void => { storeHideViewed(on); setHideViewed(on); };
  // the new (untracked) files, in Changed files: listed with the others until listed apart, then kept so per device
  const [newApart, setNewApart] = useState(storedNewFilesApart);
  // the tree column's width as the user dragged it, per device; null is its default width
  const [treeWidth, setTreeWidth] = useState(storedReviewTreeWidth);
  // the path to show (the opening's, then one a shown file links to), until it is found; one the server finds only
  // relative to the repository's root waits for the tree (`fallback`)
  const [wanted, setWanted] = useState(initialPath);
  // the line a path asked for (a comment's place): the file it is in opens whole, scrolled to it (`file` set once it is found)
  const [jump, setJump] = useState<{ line: number; file: string | null } | null>(() => {
    const line = lineOf(initialPath);
    return line === null ? null : { line, file: null };
  });
  const [fallback, setFallback] = useState<string | null>(null);

  // the branches, once per folder as soon as Branches opens or a picker shows them, and once per round; an answer for
  // another folder or an earlier round is left aside. A round's reload keeps the list it replaces, so what it decides
  // stays until the new one
  const refsWanted = branchesOpen || listWanted;
  useEffect(() => {
    const key = `${base}|${refsRound}`;
    if (!refsWanted || refsAsked.current === key) return;
    refsAsked.current = key;
    setRefs((old) => (old?.folder === base ? old : { status: "pending", folder: base }));
    fetchRepoBranches({ paneId, directory: base }).then(
      (value) => { if (refsAsked.current === key) setRefs({ status: "ready", value, folder: base }); },
      (error: unknown) => { if (refsAsked.current === key) setRefs({ status: "failed", error, folder: base }); },
    );
  }, [fetchRepoBranches, paneId, base, refsWanted, refsRound]);

  // the branch fields: as chosen, else the current branch against the default base, once the list (or its failure) is there
  const refsNow = refs !== null && refs.folder === base ? refs : null;
  const choices = useMemo(() => (refsNow?.status === "ready" ? branchChoices(refsNow.value) : null), [refsNow]);
  // without a list the defaults read the branch of the pane's folder's tree (no worktree is read without a list)
  const baseTree = tree.folder === base ? tree : { status: "pending" as const, folder: base };
  const fields: BranchPick = { ...branchDefaults(choices, baseTree.status === "ready" ? baseTree.value.repository : null), ...branchPick };
  // a field chosen does not wait for the defaults (free text while the list loads)
  const branchesReady = branchPick !== null || (refsNow !== null && refsNow.status !== "pending" && (choices !== null || baseTree.status !== "pending"));
  const baseMissing = branchesOpen && branchesReady && fields.base.trim() === "";
  // what is compared: nothing while the branch fields wait for their defaults or for a base. The fields count only under
  // Branches, so the tree naming the branch later leaves the working tree's comparison (and its loaded list) as it was.
  const picked = branchesOpen && branchesReady;
  const pickCompare = picked ? fields.compare : "";
  const pickBase = picked ? fields.base : "";
  // compare's worktree, where the list has one for it and it did not turn out to have moved on; Show uncommitted changes
  // is offered with it
  const moving = moved !== null && moved === pickCompare.trim();
  const worktree = moving ? null : worktreeOf(choices, pickCompare);
  // its parts, not the list's object: a list read again leaves the comparison (and its loaded changes) as it was
  const worktreePath = includeUncommitted ? worktree?.path ?? null : null;
  const worktreeHere = worktree?.here ?? false;
  const choice = useMemo<ReviewChoice | null>(() => {
    if (!branchesOpen) return { scope: tip };
    if (pickBase.trim() === "") return null;
    return { scope: "branches", pick: { compare: pickCompare, base: pickBase }, worktree: worktreePath === null ? null : { path: worktreePath, here: worktreeHere } };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- branchAsks makes a choice of the same names a new one
  }, [branchesOpen, tip, pickCompare, pickBase, worktreePath, worktreeHere, branchAsks]);
  const ask = useMemo(() => (choice === null ? null : reviewAsk(choice, olderBridge)), [choice, olderBridge]);
  // the folder the review reads: the pane's (or a shown file's), or compare's worktree while its uncommitted changes are
  // read. The branch list stays the pane's folder's; the comments still go to the pane
  const folder = ask?.folder ?? base;
  // a calm line under the comparison: what an older bridge leaves out, or a worktree that moved on to another branch
  const compareNote = useAnnouncedText(moving ? worktreeMovedMessage(t, moved!) : ask?.standIn ? standInMessage(t, ask.standIn) : null);
  // A switch between the pane's folder and compare's worktree closes the file shown: it lies in the folder left, and the
  // effect below that moves the review to a file outside the folder shown would move it back there. A move of `base`
  // itself (to a shown file's folder, which drops the worktree with the list) keeps it: that file is the one to show.
  const [shownFolder, setShownFolder] = useState({ base, folder });
  if (shownFolder.base !== base || shownFolder.folder !== folder) {
    setShownFolder({ base, folder });
    if (shownFolder.base === base) {
      setFile(null);
      setDecided(null);
    }
  }

  // the tree: the repository's files whatever the changes are compared with, or a plain folder's; read for each folder
  // and again for the ignored files, the tree shown staying while they are read
  useEffect(() => {
    let live = true;
    setTree((old) => (old.status === "ready" && old.folder === folder ? old : { status: "pending", folder }));
    fetchRepoDiffTree({ paneId, directory: folder, ignored: showIgnored, folder: true }).then(
      (value) => { if (live) setTree({ status: "ready", value, folder }); },
      (error: unknown) => { if (live) setTree({ status: "failed", error, folder }); },
    );
    return () => { live = false; };
  }, [fetchRepoDiffTree, paneId, folder, showIgnored]);

  // the changes, for each folder and ask; the file shown stays
  useEffect(() => {
    if (ask === null) return;
    let live = true;
    setChangeList({ status: "pending", folder, ask });
    fetchRepoDiffFiles({ paneId, directory: folder, ...ask.list, stamps: true }).then(
      (value) => { if (live) setChangeList({ status: "ready", value, folder, ask }); },
      (error: unknown) => {
        if (!live) return;
        // an older bridge: its stand-in is asked next (a new ask), the list pending meanwhile, never a failure
        if (refusedUncommitted(error, ask.list)) { setOlderBridge(true); return; }
        // the worktree has another branch checked out now: the comparison without it is asked next, the note says why,
        // and the branch list is read again, so Show uncommitted changes goes once it no longer names that worktree
        if (error instanceof ApiError && error.code === "worktree_moved") {
          setMoved(ask.list.head);
          setRefsRound((round) => round + 1);
          return;
        }
        setChangeList({ status: "failed", error, folder, ask });
      },
    );
    return () => { live = false; };
  }, [fetchRepoDiffFiles, paneId, folder, ask]);

  const treeNow = tree.folder === folder ? tree : { status: "pending" as const, folder };
  const treeValue = treeNow.status === "ready" ? treeNow.value : null;
  // the left side for `folder`: the tree and the changes as far as they are there; an answer counts only for its own ask
  const changesNow = changeList.folder === folder && changeList.ask === ask ? changeList : { status: "pending" as const, folder };
  const changesValue = changesNow.status === "ready" ? changesNow.value : null;
  // the comparison the answer resolved: its hashes for every patch and every comment (ReviewFile)
  const review = useMemo(() => (ask === null ? null : reviewComparison(ask.list, changesValue, choices)), [ask, changesValue, choices]);
  // compare's worktree is read, not the pane's folder: a failure there is the comparison's (said under Compare, the
  // option left to turn it off), never a reason to drop the controls
  const readingWorktree = (ask?.folder ?? null) !== null;
  // a folder of no repository: its own files, no changes
  const plain = !readingWorktree && (treeValue?.plain === true || (changesNow.status === "failed" && notRepository(changesNow.error)));
  // the changes cannot be read (git failing, an old bridge): the file is shown all the same, as text
  const changesBroken = changesNow.status === "failed" && !plain;
  // the folder the left side starts at: the repository's root (the changes name it first), or a plain folder's
  const root = (plain ? treeValue?.repository.root ?? folder : changesValue?.repository.root ?? treeValue?.repository.root) ?? null;
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

  const changedPaths = useMemo(() => new Set(changes.map((one) => one.path)), [changes]);
  // the list the tree shows: all of the repository's (or the folder's) files, or only those git lists as changed; then the
  // filter, and in Changed the viewed files left out once hidden (the file shown stays)
  const listShown = plain ? "all" : scope;
  const listing = listShown === "changed" ? changesNow : treeNow;
  // Hide viewed files is offered only where a file can be marked viewed: a changed file with a stamp
  const hideable = !plain && scope === "changed" && changes.some((one) => one.stamp !== undefined);
  const hidden = hideable && hideViewed ? viewedPaths : null;
  // the shown file matters only while files are hidden: otherwise a pick leaves the list as it is
  const keep = hidden === null ? null : selected;
  // List new files separately is offered where the comparison reads the working tree, the only one with untracked files
  const newFilesOffered = !plain && scope === "changed" && (ask?.list.scope === "uncommitted" || ask?.list.scope === "workspace");
  const untrackedPaths = useMemo(() => new Set(changes.filter((one) => one.status === "untracked").map((one) => one.path)), [changes]);
  const apart = newFilesOffered && newApart ? untrackedPaths : null;
  const list = useMemo(() => reviewList({
    scope: listShown,
    // Changed lists git's changes themselves: a file staged for deletion, or one a compared revision dropped, is not in the tree's files
    paths: listShown === "changed" ? [...changedPaths] : treeValue?.paths ?? [],
    query,
    hidden,
    keep,
    apart,
  }), [listShown, changedPaths, treeValue, query, hidden, keep, apart]);
  const notes: Record<ReviewListNote, string> = {
    // the tip's own words (nothing uncommitted, nothing staged); a branch comparison's are the general ones
    "nothing-changed": ask === null || choice?.scope === "branches" ? t("Nothing changed here.") : nothingChangedSentence(t, ask.list.scope),
    "no-match": t("No file matches."),
    "all-viewed": t("All changed files are viewed."),
    "all-matching-viewed": t("All matching files are viewed."),
  };
  const allViewed = list.note === "all-viewed" || list.note === "all-matching-viewed";
  const ignoredPaths = plain ? undefined : treeValue?.ignored;
  const marks = useMemo<TreeMark[]>(() => [...treeMarks(changes), ...(ignoredPaths ?? []).map((path) => ({ path, status: "ignored" as const }))], [changes, ignoredPaths]);
  // a list split in two: each tree gets its own files' marks, so a folder counts only the changes it shows
  const split = list.newPaths.length > 0;
  const [mainMarks, newMarks] = useMemo(() => (apart === null ? [marks, []] : [marks.filter((mark) => !apart.has(mark.path)), marks.filter((mark) => apart.has(mark.path))]), [marks, apart]);
  const selectedNew = selected !== null && apart?.has(selected) === true;
  // each tree as tall as its rows, every folder open (ReviewDialog.css `.is-split`)
  const splitStyles = useMemo(() => (!split ? null : [list.paths, list.newPaths].map((paths) => ({ "--review-tree-rows": drawnRows(paths) } as CSSProperties))), [split, list]);
  const listReady = listing.status === "ready";
  // a file of the repository git ignores: not among its listed files (or among those listed as ignored)
  const listedPaths = useMemo(() => new Set(treeValue?.paths ?? []), [treeValue]);
  const ignoredFile = !plain && treeValue !== null && selected !== null && change === null
    && (treeValue.ignored?.includes(selected) === true || !listedPaths.has(selected));
  const truncated = (treeValue?.truncated ?? false) || (changesValue?.truncated ?? false);
  // a refused branch comparison in red under the line, its part marked (a missing base is its part's own words); the
  // calm notes dim: a branch list that failed, an older bridge's tip-to-tip diff
  const refused = branchesOpen && changesNow.status === "failed" ? changesNow.error : null;
  const errorAt = refused === null ? null : branchFieldError(refused, readingWorktree);
  const refsFailed = refsNow?.status === "failed" && !routeMissing(refsNow.error);
  const calmNotes = plain ? [] : [
    ...(refsFailed ? [t("Branches could not be listed.")] : []),
    ...(review?.scope === "branches" && review.branches.mergeBase === null ? [t("This PC's bridge compares the branch tips.")] : []),
  ];
  // View options: only the rows that apply here. Show uncommitted changes reads compare's worktree (an older bridge
  // compares commits only, so it has none; the note under the comparison says why); Show viewed files is the stored Hide
  // viewed files turned round, under the same key; Show ignored files keeps its key
  const viewOptions: ReviewOption[] = [];
  if (!plain && scope === "changed" && branchesOpen && worktree !== null && !olderBridge) viewOptions.push({
    id: "uncommitted", label: t("Show uncommitted changes"), title: worktree.path,
    description: t("Not yet committed in {worktree}", { worktree: worktree.here ? t("this worktree") : worktree.name }),
    checked: includeUncommitted, byDefault: true, onChange: setIncludeUncommitted,
  });
  if (hideable) viewOptions.push({
    id: "viewed", label: t("Show viewed files"), description: t("Files you marked as viewed"),
    checked: !hideViewed, byDefault: true, onChange: (on) => chooseHideViewed(!on),
  });
  if (!plain && scope === "all") viewOptions.push({
    id: "ignored", label: t("Show ignored files"), description: t("Files git ignores, like build output"),
    checked: showIgnored, byDefault: false, onChange: (on) => { storeShowIgnored(on); setShowIgnored(on); },
  });
  if (newFilesOffered) viewOptions.push({
    id: "new-files", label: t("List new files separately"), description: t("Untracked files under their own heading"),
    checked: newApart, byDefault: false, onChange: (on) => { storeNewFilesApart(on); setNewApart(on); },
  });
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
          {/* where the review is: the repository, and under it what is compared, each part its picker; a plain folder by
              its name, and under it where it lies (its parent's path, cut at the end) */}
          <div className="review-title">
            <h2 className="modal-title" title={root ?? undefined}>{title}</h2>
            <div className="review-meta">
              {plain && root !== null && <span className="review-meta-path" dir="ltr" title={root}>{folderOf(root)}</span>}
              {!plain && <ComparePicker mode={branchesOpen ? "branches" : tip} compare={fields.compare} base={fields.base} branches={choices?.branches ?? null}
                listLoading={refsNow?.status === "pending"} truncated={choices?.truncated ?? false} invalid={errorAt} errorId={refusalId}
                onTip={chooseTip} onBranch={chooseBranch} onBranchesShown={() => setListWanted(true)} />}
              {truncated && <span className="review-meta-warning">{t("The list is cut short.")}</span>}
            </div>
            {/* in the document from the first render, so its words are announced (lib/useAnnouncedText.ts) */}
            <p className={compareNote === null ? "visually-hidden review-compare-note" : "review-compare-note"} role="status">{compareNote}</p>
            {calmNotes.map((note) => <p key={note} className="review-compare-note">{note}</p>)}
            {errorAt !== null && <p id={refusalId} className="review-compare-error" role="alert">{diffErrorMessage(t, refused)}</p>}
          </div>
          <button type="button" className="icon-button review-close" aria-label={t("Close review")} title={t("Close review")} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="review-body" style={{ "--review-tree-column": reviewTreeColumn(treeWidth) } as CSSProperties}>
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
            <div className="review-filter">
              <input type="search" className="input review-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Filter files")} aria-label={t("Filter files")} spellCheck={false} />
              <ReviewOptions options={viewOptions} />
            </div>
            {/* the tree loads on its own: its place holds a loader meanwhile, the file beside it is shown already */}
            {listing.status === "pending" && !(listShown === "changed" && baseMissing) && <ReviewLoading />}
            {listing.status === "failed" && !(listShown === "changed" && errorAt !== null) && <p className="repo-diff-note" role="alert">{diffErrorMessage(t, listing.error)}</p>}
            {/* why the list is short; with every file viewed, a way to show them again. The file still shown stays under it */}
            {listReady && list.note !== null && <div className="review-list-note">
              <p className="repo-diff-note">{notes[list.note]}</p>
              {allViewed && <button type="button" className="btn btn-ghost review-show-viewed" onClick={() => chooseHideViewed(false)}>{t("Show viewed files")}</button>}
            </div>}
            {/* a tree the library cannot build (a listing it refuses) is a note here: the rest of the review stays usable */}
            {/* with List new files separately, the new files follow under their own heading, a tree of their own folders */}
            {listReady && (list.paths.length > 0 || split) && <RenderBoundary resetKey={list} fallback={() => <p className="repo-diff-note" role="alert">{t("The file list can't be shown.")}</p>}>
              {list.paths.length > 0 && <ReviewTree paths={list.paths} marks={mainMarks} selected={selectedNew ? null : selected} listing={`${listShown}|${list.query}`} expandAll={list.filtered || listShown === "changed"} viewed={viewedPaths} viewedTitle={t("Viewed")} onOpen={pick}
                className={split ? "is-split" : undefined} style={splitStyles?.[0]} />}
              {split && <>
                <h3 className="review-tree-heading">{t("New files")}</h3>
                <ReviewTree paths={list.newPaths} marks={newMarks} selected={selectedNew ? selected : null} listing={`new|${list.query}`} expandAll viewed={viewedPaths} viewedTitle={t("Viewed")} onOpen={pick}
                  className="is-split is-new" style={splitStyles?.[1]} />
              </>}
            </RenderBoundary>}
          </div>
          {/* the column's edge; a phone shows the tree or the file, and a folded tree has no edge */}
          {!narrow && treeVisible && <ReviewTreeResizer width={treeWidth} onResize={setTreeWidth} />}
          <div className="review-file-pane">
            {file !== null && fileRoot !== null && decided === file
              ? <RenderBoundary resetKey={file} fallback={() => <p className="repo-diff-note" role="alert">{t("This file can't be shown.")}</p>}>
                <ReviewFile key={file} owner={paneStorageId(machineId, paneId)} paneId={paneId} directory={folder} root={fileRoot} path={file.slice(fileRoot.replace(/[\\/]+$/, "").length + 1)} change={plain ? null : change} plain={plain} ignored={ignoredFile}
                  viewed={plain || change === null || change.stamp === undefined ? null : viewedPaths.has(change.path)} onViewed={(on) => { if (change !== null) setViewed(change, on); }} diffMode={!plain && scope === "changed"} comparison={review} line={jump !== null && jump.file === file ? jump.line : undefined} onClose={closeFile} onOpen={openPath} />
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
