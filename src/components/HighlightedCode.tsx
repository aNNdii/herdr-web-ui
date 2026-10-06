import { forwardRef, Fragment, memo, useMemo, type CSSProperties, type ReactNode } from "react";

import { highlightLines } from "../lib/highlight.ts";
import { useT } from "../lib/i18n.ts";
import "./HighlightedCode.css";

interface HighlightedCodeProps {
  code: string;
  language: string | null;
  /** Characters; above it the code shows as plain text with a note. */
  limit: number;
  /** false: a host that says "too long" itself (the file viewer, in its header) */
  tooLongNote?: boolean;
  lineNumbers?: boolean;
  wrap?: boolean;
  className?: string;
  /** the source line of the first line: with it each `.hl-line` carries its number as `data-source-line` */
  firstLine?: number;
  /** what hangs under a line (the file viewer's comment cards), by its source line */
  notes?: ReadonlyMap<number, ReactNode>;
}

/**
 * Code colored by role, one `.hl-line` per source line. Every prop is a primitive, so `memo` skips
 * a parent's re-render, and the line elements are built apart from the attributes: toggling `wrap`
 * or `lineNumbers` leaves them alone. The line-number gutter is a CSS counter, so it never reaches
 * a copy.
 *
 * The lines are inline spans, each but the last followed by a literal "\n" text node, so the
 * text of the `<pre>` is the code itself: `innerText` and a copied selection keep every blank line.
 * Block lines would add a line break of their own between lines and drop or double the blank ones.
 * The "\n" stays outside the `.hl-line`: a line's element holds its text only. `notes` of a line
 * go after its "\n", as a block of their own between it and the next line; the file viewer's copy
 * leaves them out (`codeCopyText`). The ref is that `<pre>`: the file viewer selects it when the
 * clipboard is out of reach.
 */
export const HighlightedCode = memo(forwardRef<HTMLPreElement, HighlightedCodeProps>(function HighlightedCode({ code, language, limit, tooLongNote = true, lineNumbers = false, wrap = false, className, firstLine, notes }, ref) {
  const t = useT();
  const result = useMemo(() => highlightLines(code, language, limit), [code, language, limit]);
  // index keys: the lines are a static list that is rebuilt as a whole. Notes coming or going leave them alone
  const lines = useMemo(() => result.lines.map((tokens, index) => (
    <Fragment key={index}>
      <span className="hl-line" data-source-line={firstLine === undefined ? undefined : firstLine + index}>
        {tokens.map((token, n) => {
          const classes = [token.role && `hl-${token.role}`, token.emphasis && `hl-${token.emphasis}`].filter(Boolean).join(" ");
          return classes === "" ? token.text : <span className={classes} key={n}>{token.text}</span>;
        })}
      </span>
      {index < result.lines.length - 1 && "\n"}
    </Fragment>
  )), [result, firstLine]);
  const content = useMemo(() => {
    if (notes === undefined || notes.size === 0) return lines;
    const first = firstLine ?? 1;
    const withNotes: ReactNode[] = [];
    lines.forEach((line, index) => {
      withNotes.push(line);
      const note = notes.get(first + index);
      if (note !== undefined && note !== null) withNotes.push(<div key={`notes-${first + index}`} className="file-comment-notes block-comment-notes">{note}</div>);
    });
    return withNotes;
  }, [lines, notes, firstLine]);
  // the gutter is as wide as the last line's number, at least two digits
  const gutter = lineNumbers ? { "--hl-digits": String(Math.max(2, String(result.lines.length).length)) } as CSSProperties : undefined;
  return (
    <>
      <pre ref={ref} className={className ? `hl-code ${className}` : "hl-code"} style={gutter} data-line-numbers={lineNumbers ? "" : undefined} data-wrap={wrap ? "" : undefined}><code>{content}</code></pre>
      {result.tooLong && tooLongNote && <p className="hl-note">{t("Too long to highlight")}</p>}
    </>
  );
}));
