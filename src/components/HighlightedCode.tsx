import { forwardRef, Fragment, memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { canHighlight, countLines, extendLines, LINE_ELEMENT_LIMIT, normalizeCode, plainLines, type Lines } from "../lib/highlight.ts";
import { highlightedFrom, highlightKnown, highlightOffThread, type Highlighted } from "../lib/highlightOffThread.ts";
import { useT } from "../lib/i18n.ts";
import { useSettings } from "../lib/settings.ts";
import "./HighlightedCode.css";

/**
 * The lines of `code` to show now, and whether they were left plain for being too long. Highlighting
 * never holds the page: short code is highlighted at once, longer code in a worker (shown plain
 * until it answers, or with the colors it had while a reply grows), and code the worker gives up on
 * stays plain. Above `limit` characters, or `LINE_ELEMENT_LIMIT` lines, it is not tried at all;
 * otherwise the worker's budget bounds it. Off in Settings, or in a language it has no grammar for,
 * every code is plain and never too long.
 */
export function useHighlightedLines(code: string, language: string | null, limit?: number): Highlighted {
  const { settings } = useSettings();
  const source = useMemo(() => normalizeCode(code), [code]);
  const highlighted = settings.highlightCode && canHighlight(language) ? language : null;
  const manyLines = useMemo(() => countLines(source) > LINE_ELEMENT_LIMIT, [source]);
  const overLimit = highlighted !== null && ((limit !== undefined && code.length > limit) || manyLines);
  // what is known without waiting: no language, too long, short enough, or highlighted before
  const known = useMemo((): Highlighted | null => {
    if (highlighted === null || overLimit) return { lines: plainLines(source), tooLong: overLimit };
    return highlightKnown(source, highlighted);
  }, [source, highlighted, overLimit]);
  const [answer, setAnswer] = useState<{ source: string; language: string; lines: Lines | null } | null>(null);
  useEffect(() => {
    if (known !== null || highlighted === null) return;
    let live = true;
    const job = highlightOffThread(source, highlighted);
    void job.promise.then((lines) => { if (live) setAnswer({ source, language: highlighted, lines }); });
    // a newer text (a reply still growing) replaces a request that has not started
    return () => { live = false; job.cancel(); };
  }, [known, source, highlighted]);
  // the lines last shown, whose colors a growing text keeps while its new end is highlighted
  const shown = useRef<{ source: string; language: string; lines: Lines } | null>(null);
  const result = useMemo((): Highlighted => {
    if (known !== null) return known;
    if (answer !== null && answer.source === source && answer.language === highlighted) return highlightedFrom(source, answer.lines);
    const last = shown.current;
    if (last !== null && last.language === highlighted && source.startsWith(last.source)) {
      return { lines: extendLines(last.lines, source.slice(last.source.length)), tooLong: false };
    }
    return { lines: plainLines(source), tooLong: false };
  }, [known, answer, source, highlighted]);
  useEffect(() => {
    shown.current = highlighted === null || result.tooLong ? null : { source, language: highlighted, lines: result.lines };
  }, [result, source, highlighted]);
  return result;
}

interface CodeLinesProps {
  /** from `useHighlightedLines`; the same array while the code is unchanged */
  lines: Lines;
  lineNumbers?: boolean;
  wrap?: boolean;
  className?: string;
  /** the source line of the first line: with it each `.hl-line` carries its number as `data-source-line` */
  firstLine?: number;
  /** the lines in block chunks of about `CODE_CHUNK_LINES` (`.hl-chunk`): the file viewer's code view, whose lines take room */
  chunked?: boolean;
}

/**
 * About how many lines a chunk of the file viewer's code holds. A line's room (its comment card, FileViewer.css) changes
 * its box, and the browser lays out again the run of inline lines it is in: the whole file when that run is one `<code>`
 * (slow in a long file: the design spec's "Performance", docs/superpowers/specs/2026-10-11-code-view-inline-comments-design.md),
 * only its chunk when the lines are in block chunks.
 */
export const CODE_CHUNK_LINES = 200;

const blank = (tokens: Lines[number]): boolean => tokens.every((token) => token.text === "");

/**
 * Where the chunks of `lines` end (exclusive indexes, the last one `lines.length`): after `size` lines, else the first
 * line after that which is not blank and is followed by a line that is not blank. A blank line at either side of a
 * chunk's edge would be dropped from `innerText` and a copied selection (Chromium) or doubled (a "\n" kept there).
 */
function chunkEnds(lines: Lines, size: number): number[] {
  const ends: number[] = [];
  let end = 0;
  while (end < lines.length) {
    end = Math.min(lines.length, end + size);
    while (end < lines.length && (blank(lines[end - 1]!) || blank(lines[end]!))) end += 1;
    ends.push(end);
  }
  return ends;
}

/**
 * Code colored by role, one `.hl-line` per source line. `memo` skips a parent's re-render while
 * `lines` is the same array, and the line elements are built apart from the attributes: toggling
 * `wrap` or `lineNumbers` leaves them alone. The line-number gutter is a CSS counter, so it never
 * reaches a copy.
 *
 * The lines are inline spans, each but the last followed by a literal "\n" text node, so the
 * text of the `<pre>` is the code itself: `innerText` and a copied selection keep every blank line.
 * Block lines would add a line break of their own between lines and drop or double the blank ones.
 * The "\n" stays outside the `.hl-line`: a line's element holds its text only. Past
 * `LINE_ELEMENT_LIMIT` lines it is one text, as drawing an element per line would hold the page.
 * The ref is that `<pre>`: the file viewer selects it when the clipboard is out of reach.
 *
 * `chunked` puts the lines in block `.hl-chunk`s (`chunkEnds`), so a line's room lays out its chunk only. A chunk's
 * edge is a line break of its own, so the "\n" after a chunk's last line is left out, and an edge never has a blank line
 * beside it: the text, a copy and `innerText` stay the code's in Chromium and WebKit. A chunked code's numbers are its
 * lines' `data-source-line` (HighlightedCode.css), not the counter, so it always carries it (from line 1 without
 * `firstLine`).
 */
export const CodeLines = memo(forwardRef<HTMLPreElement, CodeLinesProps>(function CodeLines({ lines, lineNumbers = false, wrap = false, className, firstLine, chunked = false }, ref) {
  // one text past LINE_ELEMENT_LIMIT lines, with no numbers then: they are an element per line
  const plain = lines.length > LINE_ELEMENT_LIMIT;
  // index keys: the lines are a static list that is rebuilt as a whole
  const elements = useMemo(() => {
    if (plain) return lines.map((tokens) => tokens.map((token) => token.text).join("")).join("\n");
    const first = firstLine ?? (chunked ? 1 : undefined);
    /** Lines `start` to `end` (exclusive), a "\n" between each two. */
    const run = (start: number, end: number): JSX.Element[] => lines.slice(start, end).map((tokens, offset) => {
      const index = start + offset;
      return <Fragment key={index}>
        <span className="hl-line" data-source-line={first === undefined ? undefined : first + index}>
          {tokens.map((token, n) => token.role === null ? token.text : <span className={`hl-${token.role}`} key={n}>{token.text}</span>)}
        </span>
        {index < end - 1 && "\n"}
      </Fragment>;
    });
    if (!chunked) return run(0, lines.length);
    let start = 0;
    return chunkEnds(lines, CODE_CHUNK_LINES).map((end) => {
      const chunk = <span className="hl-chunk" key={start}>{run(start, end)}</span>;
      start = end;
      return chunk;
    });
  }, [lines, plain, firstLine, chunked]);
  const numbered = lineNumbers && !plain;
  // the gutter is as wide as the last line's number, at least two digits
  const gutter = numbered ? { "--hl-digits": String(Math.max(2, String(lines.length).length)) } as CSSProperties : undefined;
  return <pre ref={ref} className={className ? `hl-code ${className}` : "hl-code"} style={gutter} data-line-numbers={numbered ? "" : undefined} data-wrap={wrap ? "" : undefined}><code>{elements}</code></pre>;
}));

interface HighlightedCodeProps {
  code: string;
  language: string | null;
  /** Characters; above it the code shows as plain text with the note. */
  limit?: number;
  /** the source line of the first line (a code block of the file viewer's preview): its lines carry their numbers */
  firstLine?: number;
}

/**
 * A code block that highlights itself and, when it was left plain for its length, says so under
 * the code. Every prop is a primitive, so `memo` skips a parent's re-render (a chat reply's other
 * blocks while one grows). A host that says "too long" elsewhere (the file viewer, in its header)
 * calls `useHighlightedLines` and draws `CodeLines` itself.
 */
export const HighlightedCode = memo(function HighlightedCode({ code, language, limit, firstLine }: HighlightedCodeProps) {
  const t = useT();
  const { lines, tooLong } = useHighlightedLines(code, language, limit);
  return (
    <>
      <CodeLines lines={lines} firstLine={firstLine} />
      {tooLong && <p className="hl-note">{t("Too long to highlight")}</p>}
    </>
  );
});
