import { describe, expect, it } from "bun:test";
import { commentCanSave, commentChanged, editDeleted, leaveEdit, leaveKey, lineQuote, leaveOutcome, popoverChanged, popoverFocusesField, popoverOutlived, popoverStart, sheetPage, submitKey, type CommentEdit } from "./commentPopover.ts";

describe("commentChanged", () => {
  it("is unchanged while a new comment is still empty", () => {
    expect(commentChanged("", "")).toBe(false);
  });
  it("is unchanged while an edit is as it opened", () => {
    expect(commentChanged("Fix this", "Fix this")).toBe(false);
  });
  it("is changed once a new comment has any text, whitespace included", () => {
    expect(commentChanged("x", "")).toBe(true);
    expect(commentChanged(" ", "")).toBe(true);
  });
  it("is changed once an edit differs from how it opened, even when it was emptied", () => {
    expect(commentChanged("Fix that", "Fix this")).toBe(true);
    expect(commentChanged("", "Fix this")).toBe(true);
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
  it("has nothing to save in an edit left as it opened", () => {
    expect(commentCanSave("Fix this", "Fix this")).toBe(false);
  });
  it("saves an edit, also emptied: a blank edit deletes the comment", () => {
    expect(commentCanSave("Fix that", "Fix this")).toBe(true);
    expect(commentCanSave("", "Fix this")).toBe(true);
  });
});

describe("popoverStart", () => {
  it("opens a saved comment to edit, its field filled with it", () => {
    expect(popoverStart({ id: "c1", comment: "tighten this" })).toEqual({ commentId: "c1", initialComment: "tighten this" });
  });
  it("opens a new comment to write, its field empty", () => {
    expect(popoverStart(null)).toEqual({ commentId: null, initialComment: "" });
  });
});

describe("popoverChanged", () => {
  it("holds nothing while none is open", () => {
    expect(popoverChanged(null, "typed")).toBe(false);
  });
  it("holds a new comment with something typed, blanks included", () => {
    expect(popoverChanged({ initialComment: "" }, "a")).toBe(true);
    expect(popoverChanged({ initialComment: "" }, " ")).toBe(true);
  });
  it("does not hold an untouched field, a saved comment's opened filled included", () => {
    expect(popoverChanged({ initialComment: "" }, "")).toBe(false);
    expect(popoverChanged({ initialComment: "saved" }, "saved")).toBe(false);
  });
  it("holds an edit that changed the comment, emptied included", () => {
    expect(popoverChanged({ initialComment: "saved" }, "saved!")).toBe(true);
    expect(popoverChanged({ initialComment: "saved" }, "")).toBe(true);
  });
});

describe("leaveOutcome", () => {
  it("does nothing with no field open", () => {
    expect(leaveOutcome(null, "")).toBe("none");
  });
  it("closes a new comment left empty or blank: it leaves nothing", () => {
    expect(leaveOutcome({ initialComment: "" }, "")).toBe("close");
    expect(leaveOutcome({ initialComment: "" }, "  ")).toBe("close");
  });
  it("closes an edit left as it opened", () => {
    expect(leaveOutcome({ initialComment: "saved" }, "saved")).toBe("close");
  });
  it("saves a new comment with text typed", () => {
    expect(leaveOutcome({ initialComment: "" }, "draft")).toBe("save");
  });
  it("saves an emptied edit, which deletes the comment", () => {
    expect(leaveOutcome({ initialComment: "saved" }, "")).toBe("save");
  });
  it("saves a changed edit", () => {
    expect(leaveOutcome({ initialComment: "saved" }, "edited")).toBe("save");
  });
});

describe("leaveEdit", () => {
  /** An edit whose `keep` records what it was asked to keep and answers `answer`. */
  const editOf = (id: string | null, initial: string, text: string, answer: string | null): { edit: CommentEdit<{ at: number }>; kept: [{ at: number }, string][] } => {
    const kept: [{ at: number }, string][] = [];
    return { kept, edit: { id, target: { at: 1 }, initial, text, keep: (target, value) => { kept.push([target, value]); return answer; } } };
  };
  it("keeps nothing for a new comment left empty or blank, or an edit left as it opened", () => {
    for (const [id, initial, text] of [[null, "", ""], [null, "", "  "], ["c1", "saved", "saved"]] as const) {
      const { edit, kept } = editOf(id, initial, text, "never");
      expect(leaveEdit(edit)).toEqual({ kind: "closed" });
      expect(kept).toEqual([]);
    }
  });
  it("keeps a new comment's text on its target, saved under the id `keep` returns", () => {
    const { edit, kept } = editOf(null, "", "draft", "n1");
    expect(leaveEdit(edit)).toEqual({ kind: "saved", id: "n1" });
    expect(kept).toEqual([[{ at: 1 }, "draft"]]);
  });
  it("keeps a changed edit under its new id, and an emptied one as \"\", which deletes it", () => {
    const changed = editOf("c1", "saved", "edited", "c2");
    expect(leaveEdit(changed.edit)).toEqual({ kind: "saved", id: "c2" });
    expect(changed.kept).toEqual([[{ at: 1 }, "edited"]]);
    const emptied = editOf("c1", "saved", "", null);
    expect(leaveEdit(emptied.edit)).toEqual({ kind: "saved", id: null });
    expect(emptied.kept).toEqual([[{ at: 1 }, ""]]);
  });
  it("hands on a refusal: saved, with nothing stored there", () => {
    const { edit } = editOf(null, "", "draft", null);
    expect(leaveEdit(edit)).toEqual({ kind: "saved", id: null });
  });
});

describe("editDeleted", () => {
  it("is true for an edit emptied and saved: nothing is stored there now", () => {
    expect(editDeleted({ id: "c1", text: "" }, { kind: "saved", id: null })).toBe(true);
    expect(editDeleted({ id: "c1", text: "  " }, { kind: "saved", id: null })).toBe(true);
  });
  it("is false for a refusal: an edit with text that nothing kept (comments off) deleted nothing", () => {
    expect(editDeleted({ id: "c1", text: "edited" }, { kind: "saved", id: null })).toBe(false);
  });
  it("is false for an edit kept, a field closed, and a new comment", () => {
    expect(editDeleted({ id: "c1", text: "edited" }, { kind: "saved", id: "c2" })).toBe(false);
    expect(editDeleted({ id: "c1", text: "" }, { kind: "closed" })).toBe(false);
    expect(editDeleted({ id: null, text: "" }, { kind: "saved", id: null })).toBe(false);
  });
});

describe("leaveKey", () => {
  const escape = { key: "Escape", isComposing: false, keyCode: 27 };
  it("leaves on Escape", () => {
    expect(leaveKey(escape)).toBe(true);
  });
  it("leaves an Escape of an IME composition to the composition, which it cancels", () => {
    expect(leaveKey({ ...escape, isComposing: true })).toBe(false);
    expect(leaveKey({ ...escape, keyCode: 229 })).toBe(false);
  });
  it("ignores other keys", () => {
    expect(leaveKey({ ...escape, key: "Enter", keyCode: 13 })).toBe(false);
  });
});

describe("submitKey", () => {
  const enter = { key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 };
  it("saves on Enter", () => {
    expect(submitKey(enter)).toBe(true);
  });
  it("leaves Shift+Enter to break the line", () => {
    expect(submitKey({ ...enter, shiftKey: true })).toBe(false);
  });
  it("leaves an Enter of an IME composition to the composition", () => {
    expect(submitKey({ ...enter, isComposing: true })).toBe(false);
    expect(submitKey({ ...enter, keyCode: 229 })).toBe(false);
  });
  it("saves on Ctrl+Enter too", () => {
    const ctrlEnter = { ...enter, ctrlKey: true };
    expect(submitKey(ctrlEnter)).toBe(true);
  });
  it("ignores other keys", () => {
    expect(submitKey({ ...enter, key: "a", keyCode: 65 })).toBe(false);
  });
});

describe("popoverOutlived", () => {
  const stored = [{ id: "a" }, { id: "b" }];
  it("keeps a comment still stored, changed or not", () => {
    expect(popoverOutlived({ commentId: "a", initialComment: "saved" }, stored, "saved")).toBe(false);
    expect(popoverOutlived({ commentId: "a", initialComment: "saved" }, stored, "changed")).toBe(false);
  });
  it("ends an untouched comment no longer stored (sent, or deleted in another tab)", () => {
    expect(popoverOutlived({ commentId: "gone", initialComment: "saved" }, stored, "saved")).toBe(true);
    expect(popoverOutlived({ commentId: "a", initialComment: "saved" }, [], "saved")).toBe(true);
  });
  it("keeps a comment no longer stored while a change is typed in it", () => {
    expect(popoverOutlived({ commentId: "gone", initialComment: "saved" }, stored, "saved, changed")).toBe(false);
    expect(popoverOutlived({ commentId: "gone", initialComment: "saved" }, stored, "")).toBe(false);
  });
  it("never ends a new comment", () => {
    expect(popoverOutlived({ commentId: null, initialComment: "" }, [], "")).toBe(false);
    expect(popoverOutlived({ commentId: null, initialComment: "" }, [], "draft")).toBe(false);
  });
});

describe("popoverFocusesField", () => {
  it("focuses a new comment's field, with a mouse and on a touch screen", () => {
    expect(popoverFocusesField(false, false)).toBe(true);
    expect(popoverFocusesField(false, true)).toBe(true);
  });
  it("focuses a saved comment's field with a mouse", () => {
    expect(popoverFocusesField(true, false)).toBe(true);
  });
  it("leaves a saved comment's field alone on a touch screen: no keyboard rises for a tap on its card", () => {
    expect(popoverFocusesField(true, true)).toBe(false);
  });
});

describe("lineQuote", () => {
  const lines = ["import x;", "", "  if (a < b) {", "    return a;", "  }"];
  it("is the text of one line, its indentation dropped", () => {
    expect(lineQuote(lines, [3, 3])).toBe("if (a < b) {");
  });
  it("joins several lines by spaces, blank ones left out", () => {
    expect(lineQuote(lines, [1, 4])).toBe("import x; if (a < b) { return a;");
  });
  it("is empty for a blank line and past the file's end", () => {
    expect(lineQuote(lines, [2, 2])).toBe("");
    expect(lineQuote(lines, [9, 9])).toBe("");
  });
});

describe("sheetPage", () => {
  it("‹ and › step one comment and do not wrap", () => {
    expect(sheetPage(0, 2, 1, false)).toBe(1);
    expect(sheetPage(1, 2, 1, false)).toBe(1);
    expect(sheetPage(1, 2, -1, false)).toBe(0);
    expect(sheetPage(0, 2, -1, false)).toBe(0);
  });
  it("Delete stays on the next comment, else the one before, else none is left", () => {
    expect(sheetPage(1, 3, 0, true)).toBe(1);
    expect(sheetPage(2, 3, 0, true)).toBe(1);
    expect(sheetPage(0, 1, 0, true)).toBeNull();
  });
  it("a comment emptied and paged away from is deleted: › shows the one after it, ‹ the one before", () => {
    expect(sheetPage(0, 3, 1, true)).toBe(0);
    expect(sheetPage(2, 3, -1, true)).toBe(1);
    expect(sheetPage(0, 1, 1, true)).toBeNull();
  });
});
