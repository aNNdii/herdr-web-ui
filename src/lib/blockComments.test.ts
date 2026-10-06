import { describe, expect, it } from "bun:test";
import { parseMarkdown, type ListBlock, type MarkdownBlock } from "./markdown.ts";
import { BLOCK_COMMENTS_PREFIX, BlockCommentStore, blockContent, blockTarget, commentCanSave, commentTarget, commentTyped, composeWithComments, draftComment, formPlace, isBlockComment, isMarkdownBlock, noteHost, notesOnPart, outgoingMessage, partSegments, quoteExcerpt, quoteFor, replyPart, replyParts, SELECTION_QUOTE_MAX, selectionTarget, textRange, type BlockComment, type CommentTarget } from "./blockComments.ts";

const TS = "2026-10-03T10:12:00Z";
const TIME = Date.parse(TS);
const reply = replyPart("o", TS, 7, 0);
/** the first block `source` parses to */
const first = (source: string): MarkdownBlock => parseMarkdown(source)[0]!;
/** a comment as the store keeps it */
const stored = (id: string, note: string, target: CommentTarget): BlockComment => ({ id, comment: note, anchor: target.anchor, block: target.block, order: [target.turnTime!, ...target.position], ...(target.quote ? { quote: target.quote.text, range: [target.quote.start, target.quote.end] as [number, number], ...(target.quote.until ? { until: target.quote.until } : {}) } : {}) });
/** a stored comment `note` on the block `text` parses to, at `path` in `reply` */
const comment = (id: string, path: number[], text: string, note: string): BlockComment => stored(id, note, blockTarget(reply, path, first(text)));

describe("replyPart", () => {
  it("anchors a turn by its timestamp and orders it by its time", () => {
    expect(replyPart("o", TS, 7, 1)).toEqual({ owner: "o", turnKey: TS, part: 1, turnTime: TIME });
  });
  it("anchors a turn without a timestamp by its index, and leaves its time open", () => {
    expect(replyPart("o", null, 7, 0)).toEqual({ owner: "o", turnKey: "7", part: 0, turnTime: null });
  });
  it("leaves the time open for a timestamp it cannot read", () => {
    expect(replyPart("o", "yesterday", 7, 0).turnTime).toBeNull();
  });
});

describe("blockTarget", () => {
  it("anchors a block by turn, part and path and places it by part and path", () => {
    const paragraph = first("Hello");
    expect(blockTarget(reply, [2], paragraph)).toEqual({ anchor: `${TS}:0:2`, turnTime: TIME, position: [0, 2], block: paragraph });
  });

  it("stores a list item as a one-item list that keeps its number but not its nested blocks", () => {
    const list = first("3. x\n4. y\n   - z") as ListBlock;
    const target = blockTarget(reply, [0, 1], list, 1);
    expect(target.anchor.endsWith(":0.1")).toBe(true);
    expect(target.position).toEqual([0, 0, 1]);
    expect(target.block).toEqual({ type: "list", ordered: true, start: 4, items: [{ content: list.items[1]!.content }] });
  });

  it("gives an unordered list item no start", () => {
    const list = first("- a\n- b") as ListBlock;
    expect(blockTarget(reply, [0, 0], list, 0).block).toEqual({ type: "list", ordered: false, items: [{ content: list.items[0]!.content }] });
  });
});

describe("blockContent", () => {
  it("joins a paragraph's lines and drops inline markup", () => {
    expect(blockContent(first("a **b** [c](https://x)\nd"))).toBe("a b c\nd");
  });
  it("reads a heading with inline code", () => {
    expect(blockContent(first("## Title `code`"))).toBe("Title code");
  });
  it("reads a code block's source", () => {
    expect(blockContent(first("```ts\nconst a = 1;\n```"))).toBe("const a = 1;");
  });
  it("reads a table row by row", () => {
    expect(blockContent(first("| a | b |\n|---|---|\n| 1 | 2 |"))).toBe("a | b\n1 | 2");
  });
  it("reads a blockquote's blocks", () => {
    expect(blockContent(first("> one\n>\n> two"))).toBe("one\ntwo");
  });
  it("reads nothing from a rule", () => {
    expect(blockContent({ type: "hr" })).toBe("");
  });
});

describe("quoteFor", () => {
  it("collapses whitespace", () => {
    expect(quoteFor("  a\n\n b  ")).toBe("a b");
  });
  it("keeps 80 characters and cuts 81 to 79 plus an ellipsis", () => {
    expect(quoteFor("x".repeat(80))).toBe("x".repeat(80));
    const cut = quoteFor("x".repeat(81));
    expect(cut).toBe(`${"x".repeat(79)}…`);
    expect(cut.length).toBe(80);
  });
  it("never cuts an emoji in half", () => {
    const cut = quoteFor(`${"x".repeat(79)}😀😀`);
    expect(cut.endsWith("…")).toBe(true);
    // a lone surrogate: a high one not followed by a low one, or a low one not preceded by a high one
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(cut)).toBe(false);
  });
});

describe("outgoingMessage", () => {
  const a = comment("a", [0], "first", "c1");
  const b = comment("b", [1], "second", "c2");

  it("sends typed text alone when there are no comments", () => {
    expect(outgoingMessage([], "hi")).toEqual({ message: "hi", sent: [], sentIds: [], commentsHeld: null, tooLong: false, sendable: true });
  });
  it("puts comments first, in reading order, then the typed text", () => {
    const out = outgoingMessage([b, a], "text");
    expect(out.message).toBe("> first\nc1\n\n> second\nc2\n\ntext");
    expect(out.sentIds).toEqual(["a", "b"]);
  });
  it("sends comments alone when the typed text is only whitespace", () => {
    const out = outgoingMessage([a], "   ");
    expect(out.message).toBe("> first\nc1");
    expect(out.sendable).toBe(true);
  });
  it("has nothing to send without comments and text", () => {
    expect(outgoingMessage([], "  ").sendable).toBe(false);
  });
  it("keeps comments out of a slash command", () => {
    expect(outgoingMessage([a], "/compact")).toEqual({ message: "/compact", sent: [], sentIds: [], commentsHeld: "command", tooLong: false, sendable: true });
    expect(outgoingMessage([a], "  /compact").commentsHeld).toBe("command");
  });
  it("sends comments with text that only starts with a path, which is no command", () => {
    expect(outgoingMessage([a], "/Users/me/x.ts fails").commentsHeld).toBe(null);
    expect(outgoingMessage([a], "/tmp is full").commentsHeld).toBe("command");
    expect(outgoingMessage([a], "/skill:review now").commentsHeld).toBe("command");
  });
  it("keeps comments out of an answer to an open question, so the answer stays an answer", () => {
    expect(outgoingMessage([a], "1", { answering: true })).toEqual({ message: "1", sent: [], sentIds: [], commentsHeld: "answer", tooLong: false, sendable: true });
    expect(outgoingMessage([a], "", { answering: true }).sendable).toBe(false);
  });
  it("keeps comments out of a pane without an agent: the text is typed into a shell, which would run the quote", () => {
    // "> first" is a redirect to a shell: it empties the file named "first" and runs the comment as a command
    expect(outgoingMessage([a], "ls", { agent: false })).toEqual({ message: "ls", sent: [], sentIds: [], commentsHeld: "no-agent", tooLong: false, sendable: true });
    expect(outgoingMessage([a], "", { agent: false }).sendable).toBe(false);
    expect(outgoingMessage([a], "1", { answering: true, agent: false }).commentsHeld).toBe("no-agent");
    expect(outgoingMessage([], "ls", { agent: false }).commentsHeld).toBe(null);
  });
  it("refuses a message over the composer limit", () => {
    const long = { ...a, comment: "x".repeat(20_000) };
    const out = outgoingMessage([long], "");
    expect(out.tooLong).toBe(true);
    expect(out.sendable).toBe(false);
  });
});

describe("isMarkdownBlock", () => {
  it("accepts every parsed block type", () => {
    const source = "\\[\nx\n\\]\n\n# h\n\np\n\n- l\n\n> q\n\n```\nc\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---";
    const blocks = parseMarkdown(source);
    expect(new Set(blocks.map((block) => block.type))).toEqual(new Set(["math", "heading", "paragraph", "list", "blockquote", "code", "table", "hr"]));
    for (const block of blocks) expect(isMarkdownBlock(block)).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isMarkdownBlock({ type: "video" })).toBe(false);
    expect(isMarkdownBlock(null)).toBe(false);
    expect(isMarkdownBlock("x")).toBe(false);
  });
});

/** a store on an in-memory storage, with the map behind it to inspect */
function fixture() {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  return { data, storage, store: new BlockCommentStore(() => storage) };
}
const KEY = `${BLOCK_COMMENTS_PREFIX}o`;
/** the target for the block `text` parses to, at `path` in `reply` */
const at = (path: number[], text: string) => blockTarget(reply, path, first(text));

describe("BlockCommentStore", () => {
  it("keeps one comment per anchor: a second save edits it", () => {
    const { store } = fixture();
    store.save("o", at([0], "first"), "one");
    store.save("o", at([0], "first"), "two");
    expect(store.list("o").map((c) => c.comment)).toEqual(["two"]);
  });

  it("removes a comment saved blank, and the storage key with the last one", () => {
    const { store, data } = fixture();
    store.save("o", at([0], "first"), "one");
    expect(data.has(KEY)).toBe(true);
    store.save("o", at([0], "first"), "  ");
    expect(store.list("o")).toEqual([]);
    expect(data.has(KEY)).toBe(false);
  });

  it("does nothing for a blank save without a comment", () => {
    const { store } = fixture();
    let updates = 0;
    store.subscribe(() => { updates++; });
    store.save("o", at([0], "first"), "");
    expect(updates).toBe(0);
  });

  it("keeps the identity of everything a save did not change", () => {
    const { store } = fixture();
    store.save("o", at([0], "first"), "one");
    store.save("p", at([0], "first"), "other pane");
    const before = store.get("o", at([0], "first"));
    const otherPane = store.list("p");
    expect(store.list("o")).toBe(store.list("o"));
    store.save("o", at([1], "second"), "two");
    expect(store.get("o", at([0], "first"))).toBe(before);
    expect(store.list("p")).toBe(otherPane);
  });

  it("lists comments in reading order, whatever order they were saved in", () => {
    const { store } = fixture();
    store.save("o", at([3], "later"), "b");
    store.save("o", at([1], "earlier"), "a");
    expect(store.list("o").map((c) => c.comment)).toEqual(["a", "b"]);
  });

  it("removes only the given comments, so one saved during a send survives it", () => {
    const { store } = fixture();
    store.save("o", at([0], "first"), "sent");
    const sentIds = store.list("o").map((c) => c.id);
    store.save("o", at([1], "second"), "added while sending");
    store.remove("o", sentIds);
    expect(store.list("o").map((c) => c.comment)).toEqual(["added while sending"]);
  });

  it("restores what a removal took: the same comments, ids and order included", () => {
    const { store, storage } = fixture();
    store.save("o", at([3], "later"), "b");
    store.save("o", at([1], "earlier"), "a");
    const before = store.list("o");
    store.remove("o", before.map((c) => c.id));
    expect(store.list("o")).toEqual([]);
    store.restore("o", before);
    expect(store.list("o")).toEqual(before);
    expect(new BlockCommentStore(() => storage).list("o")).toEqual(before);
  });

  it("restores in one write and notifies once", () => {
    const { store } = fixture();
    store.save("o", at([0], "first"), "one");
    store.save("o", at([1], "second"), "two");
    const before = store.list("o");
    store.remove("o", before.map((c) => c.id));
    let updates = 0;
    store.subscribe(() => { updates++; });
    store.restore("o", before);
    expect(updates).toBe(1);
  });

  it("skips a restored comment whose anchor was written meanwhile: the newer one wins", () => {
    const { store } = fixture();
    store.save("o", at([0], "first"), "old one");
    store.save("o", at([1], "second"), "old two");
    const removed = store.list("o");
    store.remove("o", removed.map((c) => c.id));
    store.save("o", at([0], "first"), "newer");
    store.restore("o", removed);
    expect(store.list("o").map((c) => c.comment)).toEqual(["newer", "old two"]);
  });

  it("skips a restored comment whose anchor another tab wrote meanwhile", () => {
    const { store, data } = fixture();
    store.save("o", at([0], "first"), "old one");
    store.save("o", at([1], "second"), "old two");
    const removed = store.list("o");
    store.remove("o", removed.map((c) => c.id));
    // storage written behind the store: the other tab's comment on the first anchor
    data.set(KEY, JSON.stringify({ version: 1, comments: [stored("t", "from the other tab", at([0], "first"))] }));
    store.restore("o", removed);
    expect(store.list("o").map((c) => c.comment)).toEqual(["from the other tab", "old two"]);
  });

  it("does nothing when restoring no comments, or only ones already back", () => {
    const { store } = fixture();
    store.save("o", at([0], "first"), "one");
    const list = store.list("o");
    let updates = 0;
    store.subscribe(() => { updates++; });
    store.restore("o", []);
    store.restore("o", list);
    expect(updates).toBe(0);
    expect(store.list("o")).toBe(list);
  });

  it("keeps a comment edited while a send was on its way: the send carried the old text", () => {
    const { store } = fixture();
    store.save("o", at([0], "first"), "old");
    const sentIds = store.list("o").map((c) => c.id);
    store.save("o", at([0], "first"), "edited while sending");
    store.remove("o", sentIds);
    expect(store.list("o").map((c) => c.comment)).toEqual(["edited while sending"]);
  });

  it("keeps a comment whose block changed under its anchor when another block is commented there", () => {
    const { store } = fixture();
    store.save("o", at([0], "the old reply"), "about old");
    store.save("o", at([0], "a new reply"), "about new");
    expect(store.list("o").map((c) => c.comment).sort()).toEqual(["about new", "about old"]);
    expect(store.get("o", at([0], "a new reply"))?.comment).toBe("about new");
  });

  it("does not delete a comment whose block changed when the block now at its anchor is saved blank", () => {
    const { store } = fixture();
    store.save("o", at([0], "the old reply"), "about old");
    store.save("o", at([0], "a new reply"), "");
    expect(store.list("o").map((c) => c.comment)).toEqual(["about old"]);
  });

  it("reads back what it wrote, tables and list items included", () => {
    const { store, storage } = fixture();
    store.save("o", at([0], "| a | b |\n|---|---|\n| 1 | 2 |"), "table");
    store.save("o", blockTarget(reply, [1, 1], first("3. x\n4. y"), 1), "item");
    expect(new BlockCommentStore(() => storage).list("o")).toEqual(store.list("o"));
  });

  it("drops what it cannot read and keeps the rest", () => {
    const { data, storage } = fixture();
    data.set(KEY, "{");
    expect(new BlockCommentStore(() => storage).list("o")).toEqual([]);
    const good = stored("g", "kept", at([0], "first"));
    const video = { ...good, id: "v", anchor: "x:0:1", block: { type: "video" } };
    const broken = { ...good, id: "b", anchor: "x:0:2", block: { type: "list", ordered: false, items: [{}] } };
    data.set(KEY, JSON.stringify({ version: 1, comments: [video, good, broken] }));
    expect(new BlockCommentStore(() => storage).list("o")).toEqual([good]);
  });

  it("keeps a comment in memory when storage refuses it", () => {
    const store = new BlockCommentStore(() => ({ getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => {} }));
    store.save("o", at([0], "first"), "one");
    expect(store.list("o").map((c) => c.comment)).toEqual(["one"]);
    expect(store.isUnsaved("o")).toBe(true);
  });

  it("refreshes from storage another tab wrote, and only then notifies", () => {
    const { store, data } = fixture();
    store.save("o", at([0], "first"), "one");
    let updates = 0;
    store.subscribe(() => { updates++; });
    store.refresh("o");
    expect(updates).toBe(0);
    data.set(KEY, JSON.stringify({ version: 1, comments: [stored("t", "from the other tab", at([0], "first"))] }));
    store.refresh("o");
    expect(updates).toBe(1);
    expect(store.list("o").map((c) => c.comment)).toEqual(["from the other tab"]);
  });
});

describe("commentTarget", () => {
  it("edits a stored comment in place, where its block is not rendered", () => {
    const { store } = fixture();
    store.save("o", at([0], "first"), "one");
    store.save("o", commentTarget(store.list("o")[0]!), "two");
    expect(store.list("o").map((c) => [c.comment, c.order])).toEqual([["two", [TIME, 0, 0]]]);
  });
});

describe("BlockCommentStore.get", () => {
  it("hands out a comment only for the block it was written on: the reply may have changed under its anchor", () => {
    const { store } = fixture();
    store.save("o", at([0], "first"), "c");
    expect(store.get("o", at([0], "first"))?.comment).toBe("c");
    expect(store.get("o", at([0], "a reply that changed"))).toBeUndefined();
  });
});

describe("reading order without a turn time", () => {
  const untimed = (path: number[], text: string) => blockTarget(replyPart("o", null, 3, 0), path, first(text));

  it("places a comment on a turn without a time by when it was written, in the same unit as a turn's time", () => {
    let now = TIME + 60_000;
    const { storage } = fixture();
    const store = new BlockCommentStore(() => storage, () => now);
    store.save("o", untimed([0], "untimed"), "written after the timed turn");
    store.save("o", at([5], "timed"), "on the timed turn");
    expect(store.list("o").map((c) => c.comment)).toEqual(["on the timed turn", "written after the timed turn"]);
    now = 1;
    store.save("o", untimed([0], "untimed"), "edited");
    expect(store.list("o").map((c) => c.comment)).toEqual(["on the timed turn", "edited"]);
  });

  it("keeps such a comment across a reload", () => {
    const { store, storage } = fixture();
    store.save("o", untimed([0], "untimed"), "kept");
    expect(new BlockCommentStore(() => storage).list("o").map((c) => c.comment)).toEqual(["kept"]);
  });
});

describe("composeWithComments", () => {
  const late = comment("b", [3], "Second", "later");
  const early = comment("a", [1], "First", "earlier");
  it("equals the message outgoingMessage builds, for comments out of order with text, comments only and text only", () => {
    for (const [comments, text] of [[[late, early], "typed"], [[late, early], ""], [[], "typed"]] as const) {
      expect(composeWithComments(comments, text)).toBe(outgoingMessage(comments, text).message);
    }
    expect(composeWithComments([late, early], "typed")).toBe("> First\nearlier\n\n> Second\nlater\n\ntyped");
  });
  it("names the sent comments in reading order next to their ids", () => {
    const out = outgoingMessage([late, early], "typed");
    expect(out.sent.map((c) => c.id)).toEqual(out.sentIds);
    expect(out.sent.map((c) => c.id)).toEqual(["a", "b"]);
  });
  it("reads a stored entry only when it is a comment", () => {
    expect(isBlockComment(early)).toBe(true);
    expect(isBlockComment({ id: 1 })).toBe(false);
  });
});

describe("selectionTarget", () => {
  const part = at([2], "Alpha beta gamma");

  it("anchors the selection inside its part, orders it by its start and keeps the part's block", () => {
    const target = selectionTarget(part, "beta", 6, 10);
    expect(target).toEqual({ anchor: `${TS}:0:2@6-10`, turnTime: TIME, position: [0, 2, -1, 6], block: part.block, quote: { text: "beta", start: 6, end: 10 } });
  });

  it("trims the text, collapses runs of spaces and tabs and keeps line breaks", () => {
    expect(selectionTarget(part, "  one \t two  \n\n three \n", 0, 20).quote!.text).toBe("one two \n\n three");
  });

  it("cuts a long selection at the maximum with an ellipsis, by code points", () => {
    const cut = selectionTarget(part, "x".repeat(SELECTION_QUOTE_MAX + 1), 0, 5000).quote!.text;
    expect(cut).toBe(`${"x".repeat(SELECTION_QUOTE_MAX - 1)}…`);
    expect(Array.from(cut).length).toBe(SELECTION_QUOTE_MAX);
    expect(selectionTarget(part, "x".repeat(SELECTION_QUOTE_MAX), 0, 5000).quote!.text.length).toBe(SELECTION_QUOTE_MAX);
    const emoji = selectionTarget(part, "😀".repeat(SELECTION_QUOTE_MAX + 5), 0, 5000).quote!.text;
    expect(Array.from(emoji).length).toBe(SELECTION_QUOTE_MAX);
    expect(emoji.endsWith("😀…")).toBe(true);
  });
});

describe("selection comments in the store", () => {
  const part = at([2], "Alpha beta gamma");

  it("keeps the quote and range of a selection comment, one comment per selection", () => {
    const { store, storage } = fixture();
    store.save("o", selectionTarget(part, "Alpha", 0, 5), "first");
    store.save("o", selectionTarget(part, "gamma", 11, 16), "third");
    store.save("o", selectionTarget(part, "beta", 6, 10), "second");
    store.save("o", selectionTarget(part, "Alpha", 0, 5), "edited");
    const list = new BlockCommentStore(() => storage).list("o");
    expect(list.map((c) => [c.comment, c.quote, c.range])).toEqual([["edited", "Alpha", [0, 5]], ["second", "beta", [6, 10]], ["third", "gamma", [11, 16]]]);
    expect(list.map((c) => c.order.slice(1))).toEqual([[0, 2, -1, 0], [0, 2, -1, 6], [0, 2, -1, 11]]);
  });

  it("does nothing for a selection whose quote normalises to blank", () => {
    const { store, data } = fixture();
    let updates = 0;
    store.subscribe(() => { updates++; });
    store.save("o", selectionTarget(part, " \t\n ", 0, 4), "note");
    store.save("o", selectionTarget(part, "", 0, 0), "note");
    expect(store.list("o")).toEqual([]);
    expect(data.has(KEY)).toBe(false);
    expect(updates).toBe(0);
    // not even a blank save touches the comment already on that anchor
    store.save("o", selectionTarget(part, "beta", 0, 4), "kept");
    updates = 0;
    store.save("o", selectionTarget(part, " ", 0, 4), "");
    expect(store.list("o").map((c) => c.comment)).toEqual(["kept"]);
    expect(updates).toBe(0);
  });

  it("stores no quote for a block comment", () => {
    const { store } = fixture();
    store.save("o", part, "whole");
    expect(Object.keys(store.list("o")[0]!)).not.toContain("quote");
    expect(Object.keys(store.list("o")[0]!)).not.toContain("range");
  });

  it("edits again from the stored comment without losing the quote", () => {
    const { store } = fixture();
    store.save("o", selectionTarget(part, "beta", 6, 10), "note");
    store.save("o", commentTarget(store.list("o")[0]!), "edited");
    expect(store.list("o").map((c) => [c.comment, c.quote, c.range])).toEqual([["edited", "beta", [6, 10]]]);
  });

  it("moves a selection comment off its anchor when the part was replaced, like a block comment", () => {
    const { store } = fixture();
    store.save("o", selectionTarget(part, "beta", 6, 10), "old");
    store.save("o", selectionTarget(at([2], "Alpha beta changed"), "beta", 6, 10), "new");
    expect(store.list("o").map((c) => c.comment)).toEqual(["old", "new"]);
    expect(store.get("o", selectionTarget(part, "beta", 6, 10))).toBeUndefined();
  });

  it("restores a selection comment with its quote", () => {
    const { store } = fixture();
    store.save("o", selectionTarget(part, "beta", 6, 10), "note");
    const taken = store.list("o");
    store.remove("o", taken.map((c) => c.id));
    store.restore("o", taken);
    expect(store.list("o")).toEqual(taken);
  });
});

describe("isBlockComment with a selection", () => {
  const base = comment("a", [0], "first", "note");
  it("accepts a quote with its range, and a legacy comment without both", () => {
    expect(isBlockComment({ ...base, quote: "fi", range: [0, 2] })).toBe(true);
    expect(isBlockComment({ ...base, quote: "fi", range: [2, 2] })).toBe(true);
    expect(isBlockComment(base)).toBe(true);
  });
  it("rejects a malformed quote", () => {
    for (const quote of ["", 3, null, ["a"]]) expect(isBlockComment({ ...base, quote })).toBe(false);
  });
  it("rejects a quote without a range and a range without a quote", () => {
    expect(isBlockComment({ ...base, quote: "fi" })).toBe(false);
    expect(isBlockComment({ ...base, range: [0, 2] })).toBe(false);
  });
  it("rejects a malformed range", () => {
    for (const range of [[0], [0, 1, 2], [-1, 2], [3, 2], [0.5, 2], [0, Number.NaN], ["0", 2], null, "0-2", 5]) expect(isBlockComment({ ...base, quote: "fi", range })).toBe(false);
  });
});

describe("composing selection comments", () => {
  const part = at([2], "Alpha beta gamma");
  const selection = (id: string, text: string, start: number, end: number, note: string) => stored(id, note, selectionTarget(part, text, start, end));

  it("quotes the selected text instead of the block", () => {
    expect(composeWithComments([selection("a", "beta", 6, 10, "why")], "typed")).toBe("> beta\nwhy\n\ntyped");
  });
  it("prefixes every line of a multi-line selection, blank lines inside become a bare \">\"", () => {
    expect(composeWithComments([selection("a", "one\ntwo\n\nthree", 0, 14, "note")], "")).toBe("> one\n> two\n>\n> three\nnote");
  });
  it("keeps the one-line excerpt of the block for a legacy comment", () => {
    const legacy = comment("l", [0], "first", "old");
    expect(composeWithComments([legacy], "")).toBe("> first\nold");
  });
  it("sends two selections of one part in the order they stand in the text, whichever was written first", () => {
    const later = selection("b", "gamma", 11, 16, "second");
    const earlier = selection("a", "Alpha", 0, 5, "first");
    expect(composeWithComments([later, earlier], "")).toBe("> Alpha\nfirst\n\n> gamma\nsecond");
    expect(outgoingMessage([later, earlier], "").sentIds).toEqual(["a", "b"]);
  });
  it("sends a selection in a list item before the item's nested blocks, whatever offset it starts at", () => {
    const list = first("- Parent item words here\n  - child item") as ListBlock;
    const nested = list.items[0]!.blocks![0] as ListBlock;
    const parent = blockTarget(reply, [0, 0], list, 0);
    const words = stored("p", "parent", selectionTarget(parent, "words", 12, 17));
    const child = stored("c", "child", blockTarget(reply, [0, 0, 0, 0], nested, 0));
    expect(composeWithComments([child, words], "")).toBe("> words\nparent\n\n> child item\nchild");
    expect(outgoingMessage([child, words], "").sentIds).toEqual(["p", "c"]);
    // the comment on the whole item still comes first
    const whole = stored("w", "whole", parent);
    expect(outgoingMessage([child, words, whole], "").sentIds).toEqual(["w", "p", "c"]);
  });
  it("puts a selection after the comment on the whole block, which comes first on a tie", () => {
    const whole = stored("w", "whole", part);
    expect(composeWithComments([selection("a", "beta", 6, 10, "sel"), whole], "")).toBe("> Alpha beta gamma\nwhole\n\n> beta\nsel");
  });
});

describe("quoteExcerpt", () => {
  it("is one line with collapsed whitespace", () => {
    expect(quoteExcerpt("  a\n\n b\tc ")).toBe("a b c");
  });
  it("keeps 32 characters and cuts 33 to 31 plus an ellipsis", () => {
    expect(quoteExcerpt("x".repeat(32))).toBe("x".repeat(32));
    expect(quoteExcerpt("x".repeat(33))).toBe(`${"x".repeat(31)}…`);
  });
  it("takes another maximum and never halves an emoji", () => {
    expect(quoteExcerpt("abcdef", 4)).toBe("abc…");
    expect(quoteExcerpt("😀😀😀😀", 3)).toBe("😀😀…");
  });
});

describe("textRange", () => {
  it("finds the nodes and offsets of a range inside one node", () => {
    expect(textRange([10], 2, 6)).toEqual({ startNode: 0, startOffset: 2, endNode: 0, endOffset: 6 });
  });
  it("spans nodes", () => {
    expect(textRange([3, 4, 5], 1, 9)).toEqual({ startNode: 0, startOffset: 1, endNode: 2, endOffset: 2 });
  });
  it("starts in the next node when the range starts at a boundary, and ends in the earlier node when it ends at one", () => {
    expect(textRange([3, 4], 3, 7)).toEqual({ startNode: 1, startOffset: 0, endNode: 1, endOffset: 4 });
    expect(textRange([3, 4], 0, 3)).toEqual({ startNode: 0, startOffset: 0, endNode: 0, endOffset: 3 });
    expect(textRange([3, 4], 2, 3)).toEqual({ startNode: 0, startOffset: 2, endNode: 0, endOffset: 3 });
  });
  it("skips empty nodes at the boundaries", () => {
    expect(textRange([0, 3, 0, 4, 0], 3, 6)).toEqual({ startNode: 3, startOffset: 0, endNode: 3, endOffset: 3 });
    expect(textRange([0, 3, 0, 4, 0], 0, 7)).toEqual({ startNode: 1, startOffset: 0, endNode: 3, endOffset: 4 });
  });
  it("places an empty range at the position it names", () => {
    expect(textRange([3, 4], 2, 2)).toEqual({ startNode: 0, startOffset: 2, endNode: 0, endOffset: 2 });
    expect(textRange([3, 4], 3, 3)).toEqual({ startNode: 1, startOffset: 0, endNode: 1, endOffset: 0 });
    expect(textRange([3, 4], 7, 7)).toEqual({ startNode: 1, startOffset: 4, endNode: 1, endOffset: 4 });
    expect(textRange([0], 0, 0)).toEqual({ startNode: 0, startOffset: 0, endNode: 0, endOffset: 0 });
  });
  it("is null out of bounds, backwards, fractional or without nodes", () => {
    expect(textRange([3, 4], 0, 8)).toBeNull();
    expect(textRange([3, 4], -1, 2)).toBeNull();
    expect(textRange([3, 4], 5, 4)).toBeNull();
    expect(textRange([3, 4], 0.5, 2)).toBeNull();
    expect(textRange([3, 4], 8, 8)).toBeNull();
    expect(textRange([], 0, 0)).toBeNull();
  });
});

describe("replyParts", () => {
  it("lists the commentable parts of a reply in document order, as Markdown.tsx renders them", () => {
    const blocks = parseMarkdown("Intro\n\n- one\n  - nested\n- two\n\n---\n\n> quoted\n> - not a part\n\n```\ncode\n```");
    const parts = replyParts(reply, blocks);
    expect([...parts.keys()].map((anchor) => anchor.slice(`${TS}:0:`.length))).toEqual(["0", "1.0", "1.0.0.0", "1.1", "3", "4"]);
    expect([...parts.values()].map((part) => part.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(parts.get(`${TS}:0:1.1`)!.target).toEqual(blockTarget(reply, [1, 1], blocks[1]!, 1));
    expect(parts.get(`${TS}:0:0`)!.target).toEqual(blockTarget(reply, [0], blocks[0]!));
  });
});

describe("selections across parts", () => {
  // the reply: a paragraph, a list of two items, a rule, a paragraph
  const source = "Alpha beta\n\n- one\n- two\n\n---\n\nOmega end";
  const blocks = parseMarkdown(source);
  const parts = replyParts(reply, blocks);
  const part = (path: string): CommentTarget => parts.get(`${TS}:0:${path}`)!.target;
  const [alpha, one, two, omega] = [part("0"), part("1.0"), part("1.1"), part("3")];
  // "beta" to "Omega": from the first paragraph over both items to the last paragraph
  const spanning = selectionTarget(alpha, "beta\none\ntwo\nOmega", 6, 10, { target: omega, end: 5 });
  const spanned = stored("s", "across", spanning);

  it("anchors a spanning selection by its start and where it ends, and keeps its last part", () => {
    expect(spanning).toEqual({
      anchor: `${TS}:0:0@6-3:5`, turnTime: TIME, position: [0, 0, -1, 6], block: alpha.block,
      quote: { text: "beta\none\ntwo\nOmega", start: 6, end: 10, until: { anchor: omega.anchor, block: omega.block, end: 5 } },
    });
    // another end is another selection, and a single part's anchor stays as it was
    expect(selectionTarget(alpha, "beta\none", 6, 10, { target: one, end: 3 }).anchor).toBe(`${TS}:0:0@6-1.0:3`);
    expect(selectionTarget(alpha, "beta", 6, 10).anchor).toBe(`${TS}:0:0@6-10`);
  });

  it("takes an end in the selection's own part for no end at all", () => {
    expect(selectionTarget(alpha, "beta", 6, 10, { target: alpha, end: 10 })).toEqual(selectionTarget(alpha, "beta", 6, 10));
  });

  it("saves one comment, hangs its note under its last part and reads it back from storage", () => {
    const { store, storage } = fixture();
    store.save("o", spanning, "across");
    const [saved] = store.list("o");
    expect(saved).toMatchObject({ anchor: spanning.anchor, quote: "beta\none\ntwo\nOmega", range: [6, 10], until: { anchor: omega.anchor, block: omega.block, end: 5 }, order: [TIME, 0, 0, -1, 6] });
    expect(new BlockCommentStore(() => storage).list("o")).toEqual(store.list("o"));
    // its note hangs under the part it ends in
    expect(notesOnPart(store.list("o"), omega, parts).map((c) => c.comment)).toEqual(["across"]);
    expect(notesOnPart(store.list("o"), alpha, parts)).toEqual([]);
    expect(store.get("o", spanning)?.comment).toBe("across");
  });

  it("edits it again from the stored comment, its last part kept, and restores it", () => {
    const { store } = fixture();
    store.save("o", spanning, "across");
    expect(commentTarget(store.list("o")[0]!)).toEqual(spanning);
    store.save("o", commentTarget(store.list("o")[0]!), "edited");
    const edited = store.list("o");
    expect(edited.map((c) => [c.comment, c.anchor, c.until?.end])).toEqual([["edited", spanning.anchor, 5]]);
    store.remove("o", edited.map((c) => c.id));
    store.restore("o", edited);
    expect(store.list("o")).toEqual(edited);
  });

  it("moves it off its anchor when its first part was replaced, like any comment", () => {
    const { store } = fixture();
    store.save("o", spanning, "old");
    const changed = selectionTarget(blockTarget(reply, [0], first("Alpha beta changed")), "beta\none\ntwo\nOmega", 6, 18, { target: omega, end: 5 });
    // a reply rewritten so the same offsets end the same way: still another selection on another block
    store.save("o", { ...changed, anchor: spanning.anchor }, "new");
    expect(store.list("o").map((c) => c.comment)).toEqual(["old", "new"]);
    expect(store.list("o").map((c) => c.anchor.includes("~"))).toEqual([true, false]);
    expect(notesOnPart(store.list("o"), omega, parts)).toEqual([]);
  });

  it("keeps a comment apart whose last part was replaced under the same anchor: get has none, save moves the old one off", () => {
    const { store } = fixture();
    store.save("o", spanning, "old");
    // the same anchor (same first block, same end path and offset), but another block at the end
    const otherEnd = blockTarget(reply, [3], first("Other words"));
    const changed = selectionTarget(alpha, "beta\none\ntwo\nOther", 6, 10, { target: otherEnd, end: 5 });
    expect(changed.anchor).toBe(spanning.anchor);
    expect(store.get("o", changed)).toBeUndefined();
    store.save("o", changed, "new");
    expect(store.list("o").map((c) => [c.comment, c.anchor])).toEqual([["old", `${spanning.anchor}~${store.list("o")[0]!.id}`], ["new", spanning.anchor]]);
    expect(store.get("o", changed)?.comment).toBe("new");
    expect(store.get("o", spanning)).toBeUndefined();
  });

  it("treats a spanning and a single-part comment on one anchor as different comments", () => {
    const { store } = fixture();
    store.save("o", spanning, "old");
    // a hand-made target: the spanning anchor without an end part
    const single = { ...selectionTarget(alpha, "beta", 6, 10), anchor: spanning.anchor };
    expect(store.get("o", single)).toBeUndefined();
    store.save("o", single, "new");
    expect(store.list("o").map((c) => [c.comment, c.anchor.startsWith(`${spanning.anchor}~`)])).toEqual([["old", true], ["new", false]]);
  });

  it("edits a spanning comment in place when its last block is unchanged", () => {
    const { store } = fixture();
    store.save("o", spanning, "old");
    store.save("o", selectionTarget(alpha, "beta\none\ntwo\nOmega", 6, 10, { target: omega, end: 5 }), "new");
    expect(store.list("o").map((c) => [c.comment, c.anchor])).toEqual([["new", spanning.anchor]]);
  });

  it("quotes the whole selection, line by line", () => {
    expect(composeWithComments([spanned], "")).toBe("> beta\n> one\n> two\n> Omega\nacross");
  });

  it("orders it by where it starts, among the part's single selections and its comment on the whole part", () => {
    const whole = stored("w", "whole", alpha);
    const before = stored("b", "before", selectionTarget(alpha, "Alpha", 0, 5));
    const after = stored("a", "after", selectionTarget(alpha, "ta", 8, 10));
    const item = stored("i", "item", one);
    const last = stored("l", "last", selectionTarget(omega, "end", 6, 9));
    expect(outgoingMessage([last, item, after, spanned, before, whole], "").sentIds).toEqual(["w", "b", "s", "a", "i", "l"]);
  });

  describe("notes and segments", () => {
    const legacy = stored("w", "whole", alpha);
    const single = stored("b", "before", selectionTarget(omega, "Omega", 0, 5));
    const own = stored("t", "two", two);
    const all = [single, own, spanned, legacy];

    it("hangs a spanning comment's note under the part where the selection ends", () => {
      expect(noteHost(spanned, parts)).toBe(omega);
      expect(noteHost(legacy, parts)).toBe(alpha);
      expect(noteHost(single, parts)).toBe(omega);
      expect(notesOnPart(all, omega, parts).map((c) => c.id)).toEqual(["s", "b"]);
      expect(notesOnPart(all, alpha, parts).map((c) => c.id)).toEqual(["w"]);
      expect(notesOnPart(all, one, parts)).toEqual([]);
      expect(notesOnPart(all, two, parts).map((c) => c.id)).toEqual(["t"]);
    });

    it("gives every part a comment touches its segment: from the start, whole parts between, to the end", () => {
      const segments = (target: CommentTarget) => partSegments(all, target, parts).map((s) => [s.comment.id, s.start, s.end]);
      expect(segments(alpha)).toEqual([["w", 0, null], ["s", 6, null]]);
      expect(segments(one)).toEqual([["s", 0, null]]);
      // in reading order: the spanning comment starts in an earlier part
      expect(segments(two)).toEqual([["s", 0, null], ["t", 0, null]]);
      expect(segments(omega)).toEqual([["s", 0, 5], ["b", 0, 5]]);
    });

    it("hangs the note under the first part, and clamps the segments to it, when the last part is not rendered", () => {
      const shorter = replyParts(reply, parseMarkdown("Alpha beta\n\n- one\n- two"));
      const shortAlpha = shorter.get(alpha.anchor)!.target;
      expect(noteHost(spanned, shorter)).toBe(shortAlpha);
      expect(notesOnPart([spanned], shortAlpha, shorter).map((c) => c.id)).toEqual(["s"]);
      expect(partSegments([spanned], shortAlpha, shorter).map((s) => [s.start, s.end])).toEqual([[6, 10]]);
      expect(partSegments([spanned], shorter.get(one.anchor)!.target, shorter)).toEqual([]);
    });

    it("does the same when the last part's block was replaced", () => {
      const changed = replyParts(reply, parseMarkdown("Alpha beta\n\n- one\n- two\n\n---\n\nSomething else"));
      const changedAlpha = changed.get(alpha.anchor)!.target;
      expect(noteHost(spanned, changed)).toBe(changedAlpha);
      expect(notesOnPart([spanned], changed.get(omega.anchor)!.target, changed)).toEqual([]);
      expect(partSegments([spanned], changed.get(two.anchor)!.target, changed)).toEqual([]);
    });

    it("shows nothing of a comment whose first part was replaced or that was moved off its anchor", () => {
      const changed = replyParts(reply, parseMarkdown("Another start\n\n- one\n- two\n\n---\n\nOmega end"));
      expect(noteHost(spanned, changed)).toBeNull();
      for (const target of [...changed.values()].map((p) => p.target)) {
        expect(notesOnPart([spanned], target, changed)).toEqual([]);
        expect(partSegments([spanned], target, changed)).toEqual([]);
      }
      const moved = { ...spanned, anchor: `${spanned.anchor}~s` };
      expect(noteHost(moved, parts)).toBeNull();
      expect(noteHost({ ...legacy, anchor: `${legacy.anchor}~w` }, parts)).toBeNull();
    });

    it("gives a comment not yet written the segments its target will have once saved", () => {
      const segments = (comment: BlockComment, target: CommentTarget) => partSegments([comment], target, parts).map((s) => [s.start, s.end]);
      const draft = draftComment(spanning);
      for (const target of [alpha, one, two, omega]) expect(segments(draft, target)).toEqual(segments(spanned, target));
      expect(segments(draft, alpha)).toEqual([[6, null]]);
      expect(segments(draft, omega)).toEqual([[0, 5]]);
      const singleTarget = selectionTarget(omega, "Omega", 0, 5);
      expect(segments(draftComment(singleTarget), omega)).toEqual([[0, 5]]);
      expect(segments(draftComment(singleTarget), alpha)).toEqual([]);
      // what the store would keep, but for its id and its text
      const { store } = fixture();
      store.save("o", spanning, "across");
      const { id: _id, comment: _text, ...saved } = store.list("o")[0]!;
      const { id: _draftId, comment: _draftText, ...drafted } = draft;
      expect(drafted).toEqual(saved);
    });

    it("puts the form of a new selection comment in the host its card will have, replacing nothing", () => {
      const others = [single, own, legacy];
      expect(formPlace(others, spanning, parts)).toEqual({ host: omega, replaces: null });
      expect(formPlace(others, selectionTarget(alpha, "Alpha", 0, 5), parts)).toEqual({ host: alpha, replaces: null });
      expect(formPlace([], selectionTarget(two, "two", 0, 3), parts)).toEqual({ host: two, replaces: null });
    });

    it("puts the form of an edit in the host of the comment it replaces: a selection's, a spanning one's, a whole part's", () => {
      const place = (comment: BlockComment) => formPlace([...all, comment], commentTarget(comment), parts);
      expect(place(spanned)).toEqual({ host: omega, replaces: "s" });
      expect(place(single)).toEqual({ host: omega, replaces: "b" });
      // a comment on a whole part is edited on the part's own target
      expect(formPlace(all, alpha, parts)).toEqual({ host: alpha, replaces: "w" });
      expect(formPlace(all, two, parts)).toEqual({ host: two, replaces: "t" });
    });

    it("does not replace a comment written on another block at the same anchor", () => {
      // the same anchor as `spanned`, another block at the end: the store moves the old comment off the anchor on save
      const otherEnd = blockTarget(reply, [3], parseMarkdown("Other words")[0]!);
      const changed = selectionTarget(alpha, "beta\none\ntwo\nOther", 6, 10, { target: otherEnd, end: 5 });
      expect(changed.anchor).toBe(spanning.anchor);
      expect(formPlace(all, changed, parts)).toEqual({ host: alpha, replaces: null });
    });

    it("has no place for a target whose first part is not rendered", () => {
      const changed = replyParts(reply, parseMarkdown("Another start\n\n- one\n- two\n\n---\n\nOmega end"));
      expect(formPlace(all, spanning, changed)).toBeNull();
    });

    it("has nothing for a part of another reply", () => {
      const elsewhere = blockTarget(replyPart("o", TS, 7, 1), [0], first("Alpha beta"));
      expect(notesOnPart(all, elsewhere, parts)).toEqual([]);
      expect(partSegments(all, elsewhere, parts)).toEqual([]);
    });
  });

  describe("isBlockComment with an end part", () => {
    it("accepts a well-formed end part with a quote", () => {
      expect(isBlockComment(spanned)).toBe(true);
      expect(isBlockComment({ ...spanned, until: { ...spanned.until!, end: 0 } })).toBe(true);
    });
    it("rejects an end part without a quote", () => {
      const { quote: _quote, range: _range, ...whole } = spanned;
      expect(isBlockComment(whole)).toBe(false);
    });
    it("rejects a malformed end part", () => {
      const until = spanned.until!;
      for (const bad of [null, "3:5", 5, [], { ...until, anchor: "" }, { ...until, anchor: 3 }, { ...until, block: { type: "video" } }, { ...until, block: undefined },
        { ...until, block: { type: "list", ordered: false, items: [{}] } }, { ...until, end: -1 }, { ...until, end: 0.5 }, { ...until, end: "5" }, { ...until, end: Number.NaN }]) {
        expect(isBlockComment({ ...spanned, until: bad })).toBe(false);
      }
    });
  });
});

describe("commentTyped", () => {
  it("is not typed while a new comment is still empty", () => {
    expect(commentTyped("", "")).toBe(false);
  });
  it("is not typed while an edit is as it opened", () => {
    expect(commentTyped("Fix this", "Fix this")).toBe(false);
  });
  it("is typed once a new comment has any text, whitespace included", () => {
    expect(commentTyped("x", "")).toBe(true);
    expect(commentTyped(" ", "")).toBe(true);
  });
  it("is typed once an edit differs from how it opened, even when it was emptied", () => {
    expect(commentTyped("Fix that", "Fix this")).toBe(true);
    expect(commentTyped("", "Fix this")).toBe(true);
  });
});

describe("commentCanSave", () => {
  it("has nothing to save in a new comment that is empty or blank", () => {
    expect(commentCanSave("", "")).toBe(false);
    expect(commentCanSave("  \n", "")).toBe(false);
  });
  it("saves a new comment with text", () => {
    expect(commentCanSave("Fix this", "")).toBe(true);
  });
  it("saves an edit, also emptied: a blank edit deletes the comment", () => {
    expect(commentCanSave("Fix that", "Fix this")).toBe(true);
    expect(commentCanSave("", "Fix this")).toBe(true);
  });
});
