import { sortFileComments, type FileComment, type LineRange } from "./fileComments.ts";

/** The comment cards drawn under one code line. */
export interface CodeCommentRow {
  line: number;
  comments: FileComment[];
}

/**
 * One row per line that ends a shown comment (the last line of the lines it is placed on), by line;
 * the comments of a row in the order they are sent (`sortFileComments`). `shown` is `useFileComments(...).shown`.
 */
export function codeCommentRows(shown: readonly { comment: FileComment; lines: LineRange }[]): CodeCommentRow[] {
  const placedAt = new Map<FileComment, number>(shown.map(({ comment, lines }) => [comment, lines[1]]));
  const rows = new Map<number, FileComment[]>();
  for (const comment of sortFileComments(shown.map((placed) => placed.comment))) {
    const line = placedAt.get(comment)!;
    const row = rows.get(line);
    if (row) row.push(comment);
    else rows.set(line, [comment]);
  }
  return [...rows].map(([line, comments]) => ({ line, comments })).sort((a, b) => a.line - b.line);
}
