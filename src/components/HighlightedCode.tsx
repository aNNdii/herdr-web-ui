import { Fragment, memo, useMemo, type CSSProperties } from "react";

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
}

/**
 * Code colored by role, one `.hl-line` per source line. Every prop is a primitive, so `memo` skips
 * a parent's re-render, and the line elements are built apart from the attributes: toggling `wrap`
 * or `lineNumbers` leaves them alone. The line-number gutter is a CSS counter, so it never reaches
 * a copy.
 *
 * The lines are inline spans joined by literal "\n" text nodes (none after the last line), so the
 * text of the `<pre>` is the code itself: `innerText` and a copied selection keep every blank line.
 * Block lines would add a line break of their own between lines and drop or double the blank ones.
 */
export const HighlightedCode = memo(function HighlightedCode({ code, language, limit, tooLongNote = true, lineNumbers = false, wrap = false, className }: HighlightedCodeProps) {
  const t = useT();
  const result = useMemo(() => highlightLines(code, language, limit), [code, language, limit]);
  // index keys: the lines are a static list that is rebuilt as a whole
  const lines = useMemo(() => result.lines.map((tokens, index) => (
    <Fragment key={index}>
      {index > 0 && "\n"}
      <span className="hl-line">
        {tokens.map((token, n) => {
          const classes = [token.role && `hl-${token.role}`, token.emphasis && `hl-${token.emphasis}`].filter(Boolean).join(" ");
          return classes === "" ? token.text : <span className={classes} key={n}>{token.text}</span>;
        })}
      </span>
    </Fragment>
  )), [result]);
  // the gutter is as wide as the last line's number, at least two digits
  const gutter = lineNumbers ? { "--hl-digits": String(Math.max(2, String(result.lines.length).length)) } as CSSProperties : undefined;
  return (
    <>
      <pre className={className ? `hl-code ${className}` : "hl-code"} style={gutter} data-line-numbers={lineNumbers ? "" : undefined} data-wrap={wrap ? "" : undefined}><code>{lines}</code></pre>
      {result.tooLong && tooLongNote && <p className="hl-note">{t("Too long to highlight")}</p>}
    </>
  );
});
