import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Folder, FolderOpen, GitBranch, RefreshCw } from "lucide-react";

import "./RepoChanges.css";
import { FileGlyph } from "./FileGlyph.tsx";
import { FileNameText, FolderPathText } from "./PathText.tsx";
import { Skeleton } from "./Skeleton.tsx";

import type { RepoDiffFile, RepoDiffFileList, RepoDiffScope } from "../../shared/protocol.ts";
import { changeTree, changeTreeFolders, type ChangeTreeEntry } from "../lib/changeTree.ts";
import { useLocale, useT } from "../lib/i18n.ts";
import { useMachineApi } from "../lib/machineContext.tsx";
import { bridgeAsk, diffErrorMessage, nothingChangedWord, refusedUncommitted, standInMessage, STATUS_MARK, statusWord, type RepoComparison } from "../lib/repoDiff.ts";
import { skeletonRows } from "../lib/skeleton.ts";
import { useAnnouncedText } from "../lib/useAnnouncedText.ts";

export interface RepoChangesProps {
  paneId: string;
  /** the pane's folder, read when the pane is gone */
  directory: string;
  onOpenDiff: (comparison: RepoComparison, file: RepoDiffFile) => void;
}

type Load = { status: "pending" } | { status: "failed"; error: unknown } | { status: "ready"; listing: RepoDiffFileList };
const PENDING: Load = { status: "pending" };

/**
 * What changed in the repository the pane sits in: everything not committed yet, the index, or two
 * commits, one file per row with its status and counts, each opened as its diff, under the folders
 * they sit in (lib/changeTree.ts): every folder starts open, and what the reader folds stays folded
 * across refreshes and comparisons. The list is read on each choice and on Refresh, never polled;
 * while it is read, the last list's repository line stays and placeholder rows hold its height.
 * A bridge from before `uncommitted` refuses it once; from then on this asks it the unstaged list
 * instead and says so under the segments (lib/repoDiff.ts bridgeAsk).
 */
export function RepoChanges({ paneId, directory, onOpenDiff }: RepoChangesProps) {
  const t = useT();
  const locale = useLocale();
  const { fetchRepoDiffFiles } = useMachineApi();
  const [scope, setScope] = useState<RepoDiffScope>("uncommitted");
  const [base, setBase] = useState("");
  const [head, setHead] = useState("");
  // the comparison chosen last: a commit comparison waits for Compare, the others read on choice
  const [wanted, setWanted] = useState<RepoComparison | null>({ scope: "uncommitted", base: null, head: null });
  // this PC's bridge refused `uncommitted` as an unknown scope: kept for as long as the tab is open
  const [olderBridge, setOlderBridge] = useState(false);
  const { asked, standIn } = useMemo(() => (wanted === null ? { asked: null, standIn: null } : bridgeAsk(wanted, olderBridge)), [wanted, olderBridge]);
  // one calm line under the segments while the stand-in is read, in the document from the first render (lib/useAnnouncedText.ts)
  const bridgeNote = useAnnouncedText(standIn === null ? null : standInMessage(t, standIn));
  const [load, setLoad] = useState<Load>(PENDING);
  // the last listing, kept while the next is read: its repository line stays and its rows size the placeholders
  const [last, setLast] = useState<RepoDiffFileList | null>(null);
  const request = useRef(0);

  const read = useCallback((comparison: RepoComparison) => {
    const id = ++request.current;
    setLoad(PENDING);
    fetchRepoDiffFiles({ paneId, directory, ...comparison }).then(
      (listing) => {
        if (id !== request.current) return;
        setLoad({ status: "ready", listing });
        setLast(listing);
      },
      (error: unknown) => {
        if (id !== request.current) return;
        // the stand-in is asked next, by the effect below: the list stays pending, never a failure
        if (refusedUncommitted(error, comparison)) setOlderBridge(true);
        else setLoad({ status: "failed", error });
      },
    );
  }, [fetchRepoDiffFiles, paneId, directory]);

  useEffect(() => { if (asked !== null) read(asked); }, [asked, read]);

  const choose = (next: RepoDiffScope): void => {
    setScope(next);
    if (next === "commit") { setWanted(null); setLoad(PENDING); return; }
    setWanted({ scope: next, base: null, head: null });
  };
  const compare = (event: FormEvent): void => {
    event.preventDefault();
    const from = base.trim();
    if (from === "") return;
    setWanted({ scope: "commit", base: from, head: head.trim() || null });
  };

  const listing = load.status === "ready" ? load.listing : null;
  // a file is read from the comparison the list answered for: a commit comparison's hashes
  const answered: RepoComparison | null = listing !== null ? { scope: listing.scope, base: listing.base, head: listing.head } : null;
  const repository = listing?.repository ?? last?.repository ?? null;
  const branch = repository === null ? null : repository.branch ?? (repository.unborn ? t("No commits yet") : t("Detached HEAD"));
  // the last list's folders keep the fold-all control steady while the next list is read
  const shown = listing ?? last;
  const tree = useMemo(() => changeTree(shown === null ? [] : shown.files.map((file) => file.path)), [shown]);
  const folders = useMemo(() => changeTreeFolders(tree), [tree]);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const allOpen = folders.every((path) => !folded.has(path));
  const toggle = (path: string): void => setFolded((current) => {
    const next = new Set(current);
    if (!next.delete(path)) next.add(path);
    return next;
  });

  const rows = (entries: readonly ChangeTreeEntry[], files: readonly RepoDiffFile[], comparison: RepoComparison): ReactNode[] => entries.map((entry) => {
    const indent = { "--depth": entry.depth } as CSSProperties;
    if (entry.kind === "folder") {
      const open = !folded.has(entry.path);
      return <li key={`folder:${entry.path}`}>
        <button type="button" className="repo-change-folder" style={indent} aria-expanded={open} onClick={() => toggle(entry.path)}>
          <span className="repo-change-caret" aria-hidden="true">{open ? <ChevronDown /> : <ChevronRight />}</span>
          {open ? <FolderOpen className="repo-change-glyph" aria-hidden="true" /> : <Folder className="repo-change-glyph" aria-hidden="true" />}
          <span className="repo-change-folder-name" dir="ltr" title={entry.path}><FolderPathText path={entry.name} /></span>
          <span className="repo-change-folder-count" aria-hidden="true">{entry.files.toLocaleString(locale)}</span>
        </button>
        {open && <ul className="repo-change-children">{rows(entry.entries, files, comparison)}</ul>}
      </li>;
    }
    const file = files[entry.index]!;
    const word = statusWord(t, file.status);
    // the folder is said, not shown: the row sits under it, and assistive tech (and the browser scripts) read the whole path
    const folder = file.path.slice(0, file.path.length - entry.name.length);
    // a rename within the folder names only the old file; one from elsewhere says where from
    const sameFolder = file.old_path !== null && file.old_path.slice(0, file.old_path.lastIndexOf("/") + 1) === folder;
    return <li key={file.path}>
      <button type="button" className="repo-change" style={indent} onClick={() => onOpenDiff(comparison, file)}>
        <span className="repo-change-mark" data-status={file.status} aria-hidden="true">{STATUS_MARK[file.status]}</span>
        <span className="visually-hidden">{word}</span>
        <FileGlyph name={file.path} className="repo-change-glyph" />
        <span className="repo-change-path" title={file.old_path === null ? file.path : t("Renamed from {path}", { path: file.old_path })}>
          {file.old_path !== null && <><span className="repo-change-old">{sameFolder && folder !== "" && <span className="visually-hidden">{folder}</span>}<FileNameText name={sameFolder ? file.old_path.slice(folder.length) : file.old_path} /></span><span className="repo-change-arrow"> → </span></>}{folder !== "" && <span className="visually-hidden">{folder}</span>}<FileNameText name={entry.name} />
        </span>
        {file.binary === true
          ? <span className="repo-change-counts">{t("Binary")}</span>
          : file.additions !== null && file.deletions !== null && <span className="repo-change-counts">
            <span className="repo-change-added">+{file.additions.toLocaleString(locale)}</span>
            <span className="repo-change-deleted">−{file.deletions.toLocaleString(locale)}</span>
          </span>}
      </button>
    </li>;
  });

  return (
    <div className="repo-changes" role="group" aria-label={t("Changes")} aria-busy={load.status === "pending"}>
      <div className="repo-changes-bar">
        <div className="segmented repo-changes-scopes" role="group" aria-label={t("Compare")}>
          <button type="button" aria-pressed={scope === "uncommitted"} onClick={() => choose("uncommitted")}>{t("Uncommitted")}</button>
          <button type="button" aria-pressed={scope === "staged"} onClick={() => choose("staged")}>{t("Staged")}</button>
          <button type="button" aria-pressed={scope === "commit"} onClick={() => choose("commit")}>{t("Commits")}</button>
        </div>
        <div className="repo-changes-tools">
          <button type="button" className="icon-button" aria-label={allOpen ? t("Collapse all folders") : t("Expand all folders")} title={allOpen ? t("Collapse all folders") : t("Expand all folders")} disabled={folders.length === 0} onClick={() => setFolded(allOpen ? new Set(folders) : new Set())}>
            {allOpen ? <ChevronsDownUp aria-hidden="true" /> : <ChevronsUpDown aria-hidden="true" />}
          </button>
          <button type="button" className="icon-button" aria-label={t("Refresh changes")} title={t("Refresh changes")} disabled={asked === null || load.status === "pending"} onClick={() => asked !== null && read(asked)}>
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className={bridgeNote === null ? "visually-hidden repo-changes-bridge" : "repo-changes-bridge"} role="status">{bridgeNote}</p>
      {scope === "commit" && (
        <form className="repo-changes-commits" onSubmit={compare}>
          <label className="field">
            <span className="field-label">{t("From commit")}</span>
            <input className="input" value={base} onChange={(event) => setBase(event.target.value)} placeholder="HEAD~1" autoComplete="off" spellCheck={false} required />
          </label>
          <label className="field">
            <span className="field-label">{t("To commit")}</span>
            <input className="input" value={head} onChange={(event) => setHead(event.target.value)} placeholder="HEAD" autoComplete="off" spellCheck={false} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={base.trim() === ""}>{t("Compare")}</button>
        </form>
      )}
      {repository !== null && (
        <p className="repo-changes-repo" title={repository.root}>
          <span className="repo-changes-branch"><GitBranch aria-hidden="true" />{branch}</span>
          <span className="repo-changes-root"><span dir="ltr">{repository.root}</span></span>
        </p>
      )}
      {load.status === "failed"
        ? <p className="repo-changes-note repo-changes-error" role="alert">{diffErrorMessage(t, load.error)}</p>
        : <ul className="repo-changes-list" aria-label={t("Changed files")} data-scope={listing?.scope}>
          {load.status === "pending" && <li className="repo-changes-loading" role="status">
            <span className="visually-hidden">{t("Loading…")}</span>
            {skeletonRows(last === null ? null : last.files.length).map((width, index) => <span key={index} className="repo-change-skeleton" aria-hidden="true">
              <Skeleton className="repo-change-skeleton-mark" />
              <Skeleton className="repo-change-skeleton-glyph" />
              <Skeleton width={width} />
              <Skeleton className="repo-change-skeleton-counts" />
            </span>)}
          </li>}
          {listing !== null && answered !== null && rows(tree, listing.files, answered)}
          {listing !== null && listing.files.length === 0 && <li className="repo-changes-note">{nothingChangedWord(t, listing.scope)}</li>}
          {listing?.truncated && <li className="repo-changes-note" role="status">
            {listing.total === null
              ? t("The list was cut short; only the first {count} files are shown.", { count: listing.files.length.toLocaleString(locale) })
              : t("Showing the first {count} of {total} changed files.", { count: listing.files.length.toLocaleString(locale), total: listing.total.toLocaleString(locale) })}
          </li>}
        </ul>}
    </div>
  );
}
